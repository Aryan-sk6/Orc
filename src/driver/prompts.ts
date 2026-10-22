import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CheckResult } from "../checks/run-checks.js";
import type { CheckCommand } from "../config/types.js";
import { errorMessage, OrcError } from "../core/errors.js";
import type { LogEntry } from "../vault/log.js";
import { formatLogLine } from "../vault/log.js";
import type { PlanTask, Workstream } from "../vault/plan.js";
import { type ContextFile, clip, relevantDocs, type SessionContext } from "./context.js";
import { DRIVER_REPLY_PROTOCOL } from "./reply.js";

/** The shared driver prompt. Same relative path from src/driver/ (tests) and dist/driver/. */
export const DRIVER_PROMPT_PATH = fileURLToPath(
  new URL("../../kit/prompts/driver.md", import.meta.url),
);

export async function loadDriverPrompt(path: string = DRIVER_PROMPT_PATH): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new OrcError(
      "PROMPT_NOT_FOUND",
      `cannot read the driver prompt ${path}: ${errorMessage(error)}`,
    );
  }
}

/** Kept short on purpose: failing output is the part the agent needs, not a long recap. */
const MAX_OUTPUT_PER_CHECK = 3000;

function section(title: string, body: string): string {
  return body.trim() === "" ? "" : `\n## ${title}\n\n${body.trim()}\n`;
}

function fileBlocks(files: readonly ContextFile[]): string {
  return files.map((file) => `### ${file.path}\n\n${clip(file.content)}`).join("\n\n");
}

function checkList(checks: readonly CheckCommand[]): string {
  return checks.map((check) => `- ${check.name}: \`${check.command}\``).join("\n");
}

export interface FirstTaskPromptInput {
  readonly workstream: Workstream;
  readonly task: PlanTask;
  readonly context: SessionContext;
  readonly checks: readonly CheckCommand[];
  /** Absolute path of the main vault, for the agent to read if it needs more. */
  readonly vaultPath: string;
}

/** The only long prompt of a session: the agent keeps this context for every later turn. */
export function firstTaskPrompt(input: FirstTaskPromptInput): string {
  const { workstream, task, context } = input;
  const owns =
    workstream.owns.length === 0
      ? "No file ownership was declared; stay within what the task needs."
      : workstream.owns.map((path) => `- ${path}`).join("\n");
  const done = workstream.definitionOfDone.map((item) => `- ${item}`).join("\n");
  const docs = relevantDocs(context.docs, [context.workstreamNote, task.title]);

  return `You are the coding session for the "${workstream.name}" workstream of this app. orc runs one session per workstream, each in its own git worktree, and checks your work after every turn.

## How you work

- Do one task at a time, exactly as written. Stop when the task is finished; orc sends the next one.
- Stay inside the files this workstream owns. The contracts are frozen: never edit them. If a contract is wrong or missing something, say so in your final message instead of changing it.
- After you change code, run the checks yourself and fix what they report. orc runs the same checks after your turn:
${checkList(input.checks)}
- Don't edit anything under the vault (${input.vaultPath}). Don't commit; orc commits for you.
- If AGENTS.md or CLAUDE.md contains an "orc orchestrator" section, ignore it: it is for the person's interactive session, and you are here to write code.
- Your final message is a short summary: what you did, what you ran, anything you could not do.
${section("Workstream goal", workstream.goal)}${section("Files this workstream owns", owns)}${section("Definition of done", done)}${section("The app's agents.md", clip(context.agentsMd, 12000))}${section("Contracts", fileBlocks(context.contracts))}${section("Docs", fileBlocks(docs))}${section("User rules", context.rules)}
## Your first task: ${task.id}

${task.title}
`;
}

/** No model call: the next task is already in the plan. */
export function nextTaskPrompt(task: PlanTask, previous: PlanTask | null): string {
  const lead =
    previous === null
      ? "orc was restarted and is continuing this workstream. Next task,"
      : `${previous.id} passed all checks. Next task,`;
  return `${lead} ${task.id}:

${task.title}

Same rules as before. Finish with a short summary.`;
}

/** Sent when a turn ended without a usable result (out of turns, backend error). */
export function continuePrompt(outcome: string, errors: readonly string[], task: PlanTask): string {
  const why = errors.length === 0 ? "" : `\nDetails: ${errors.join("; ")}`;
  return `Your last turn on ${task.id} ended early (${outcome}).${why}\n\nContinue ${task.id} from where you stopped, finish it, run the checks and give a short summary.`;
}

export function formatCheckFailures(results: readonly CheckResult[]): string {
  return results
    .filter((result) => result.status === "fail")
    .map((result) => {
      const how = result.timedOut
        ? "timed out"
        : result.exitCode === null
          ? "could not run"
          : `exit ${result.exitCode}`;
      const output = result.output.trim();
      const shown =
        output.length <= MAX_OUTPUT_PER_CHECK ? output : `…${output.slice(-MAX_OUTPUT_PER_CHECK)}`;
      return `### ${result.name} (\`${result.command}\`, ${how})\n\n\`\`\`\n${shown}\n\`\`\``;
    })
    .join("\n\n");
}

/** The fix prompt sent to the coding agent: the driver's instruction plus the raw failures. */
export function fixPrompt(
  instruction: string,
  results: readonly CheckResult[],
  deniedActions: readonly string[],
): string {
  const denied =
    deniedActions.length === 0
      ? ""
      : `\n\nThese actions were blocked (not allowed in this session):\n${deniedActions.map((a) => `- ${a}`).join("\n")}`;
  return `${instruction.trim()}\n\nCheck output:\n\n${formatCheckFailures(results)}${denied}\n\nFix it, run the checks again and give a short summary.`;
}

/** Used when the driver escalated reversibly: its default becomes the instruction. */
export function defaultDecisionPrompt(
  question: string,
  defaultTaken: string,
  decisionId: string,
  results: readonly CheckResult[],
): string {
  return `Open question (${decisionId}): ${question}\n\nDecision for now: ${defaultTaken}. It is recorded as reversible, so proceed with it.\n\nCheck output:\n\n${formatCheckFailures(results)}\n\nFix it, run the checks again and give a short summary.`;
}

/** Last-resort instruction when the driver model gave no usable reply. */
export function plainFixInstruction(task: PlanTask): string {
  return `The checks failed after ${task.id}. Read the output below, find the cause and fix it without weakening any check.`;
}

export interface DriverPromptInput {
  readonly workstream: Workstream;
  readonly task: PlanTask;
  readonly context: SessionContext;
  readonly logTail: readonly LogEntry[];
  /** The agent's last final message. */
  readonly lastSummary: string;
  readonly results: readonly CheckResult[];
  readonly deniedActions: readonly string[];
  /** Fix attempts already made for this task, and the cap. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/** Context for the driver model: what it needs to word one short instruction or escalate. */
export function driverPrompt(input: DriverPromptInput): string {
  const { context, task } = input;
  const failures = formatCheckFailures(input.results);
  const docs = relevantDocs(context.docs, [
    context.workstreamNote,
    task.title,
    failures,
    input.lastSummary,
  ]);
  const log = input.logTail.map(formatLogLine).join("\n");
  const denied =
    input.deniedActions.length === 0 ? "" : input.deniedActions.map((a) => `- ${a}`).join("\n");

  return `Workstream "${input.workstream.name}", task ${task.id}: ${task.title}
Fix attempt ${input.attempt + 1} of ${input.maxAttempts} (the cap is hard: after it the session pauses).
${section("Failed checks", failures)}${section("Actions that were blocked", denied)}${section("The agent's last summary", clip(input.lastSummary, 2000))}${section("Last log lines", log)}${section("Workstream plan", clip(context.workstreamNote))}${section("The app's agents.md", clip(context.agentsMd, 6000))}${section("Contracts", fileBlocks(context.contracts))}${section("Docs", fileBlocks(docs))}${section("User rules", context.rules)}
Decide now. ${DRIVER_REPLY_PROTOCOL}
`;
}

export function driverRepairPrompt(issues: readonly string[]): string {
  return `orc could not use your last reply:\n\n${issues.map((i) => `- ${i}`).join("\n")}\n\nSend the decision again. ${DRIVER_REPLY_PROTOCOL}`;
}
