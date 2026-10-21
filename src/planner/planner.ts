import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAdapter, AgentTurnResult } from "../agents/adapter.js";
import type { OrcConfig } from "../config/types.js";
import { OrcError } from "../core/errors.js";
import { readFileIfExists, writeFileAtomic } from "../core/fs.js";
import { ensureVault } from "../vault/init.js";
import { VAULT_LAYOUT, type VaultPaths } from "../vault/layout.js";
import { appendLog, formatTimestamp } from "../vault/log.js";
import {
  type ParseResult,
  PLAN_FILES,
  type Plan,
  parsePlan,
  readPlanFiles,
  renderTaskGraph,
} from "../vault/plan.js";
import { roundUsd } from "../vault/session-note.js";
import { type AnsweredQuestion, planPrompt, questionsPrompt, repairPrompt } from "./prompts.js";
import {
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  type PlannerQuestion,
  parseFileBlocks,
  parseQuestions,
} from "./protocol.js";

/** Session name used for the planner's LOG lines. */
export const PLANNER_SESSION = "planner";

/** Returns the user's answer, or null for "no preference" (the planner's default is used). */
export type AskQuestion = (
  question: PlannerQuestion,
  index: number,
  total: number,
) => Promise<string | null>;

export interface RunPlannerOptions {
  readonly adapter: AgentAdapter;
  readonly config: OrcConfig;
  /** The target app's root: the planner's working directory. */
  readonly rootDir: string;
  readonly vault: VaultPaths;
  readonly idea: { readonly file: string; readonly text: string };
  /** Contents of kit/prompts/planner.md, sent as the system prompt on every turn. */
  readonly systemPrompt: string;
  readonly ask: AskQuestion;
  readonly now: () => Date;
  /** Replace an existing plan. Without it, an existing plan is an error (before any model call). */
  readonly force: boolean;
  readonly onProgress?: ((message: string) => void) | undefined;
}

export interface PlannerResult {
  readonly plan: Plan;
  /** Vault-relative paths written, including orc's questions.md and task-graph.md. */
  readonly written: readonly string[];
  readonly answers: readonly AnsweredQuestion[];
  /** Estimated USD across all planner turns (Agent SDK estimate, not billing data). */
  readonly costUsd: number;
  readonly turns: number;
  readonly sessionId: string;
  readonly warnings: readonly string[];
}

interface PlanOutput {
  readonly files: ReadonlyMap<string, string>;
  readonly plan: Plan;
}

const NO_PREFERENCE = "No preference: decide yourself and say what you chose in the plan.";

/**
 * `orc plan`: asks the planner for clarifying questions, collects answers, then has the same
 * session write the plan. Every reply is validated before anything is written; invalid replies
 * get up to `retries.maxPerTask` repair turns.
 */
export async function runPlanner(options: RunPlannerOptions): Promise<PlannerResult> {
  const { adapter, config, vault } = options;
  const progress = options.onProgress ?? (() => undefined);
  const warnings: string[] = [];

  if (!options.force && (await hasPlan(vault))) {
    throw new OrcError(
      "PLAN_EXISTS",
      `a plan already exists in ${vault.planDir}. Re-run with --force to replace it.`,
    );
  }
  await ensureVault(vault);
  const rules = (await readFileIfExists(vault.rules)) ?? "";

  let spent = 0;
  let turns = 0;
  let sessionId: string | undefined;

  const runTurn = async (prompt: string): Promise<AgentTurnResult> => {
    const remaining = config.maxBudgetUsd - spent;
    if (remaining <= 0) {
      throw budgetError(spent, config.maxBudgetUsd);
    }
    const result = await adapter.runTurn({
      prompt,
      cwd: options.rootDir,
      model: config.planner.model,
      systemPrompt: options.systemPrompt,
      resumeSessionId: sessionId,
      access: "read-only",
      maxBudgetUsd: remaining,
      onEvent: (event) => {
        if (event.type === "tool") {
          progress(`  · ${event.name}`);
        }
      },
    });
    spent += result.costUsd;
    turns += 1;
    sessionId = result.sessionId;
    if (result.outcome === "max_budget") {
      throw budgetError(spent, config.maxBudgetUsd);
    }
    if (result.outcome !== "success") {
      throw new OrcError(
        "AGENT_FAILED",
        `the planner turn ended with "${result.outcome}" (spent ~${usd(spent)})`,
        result.errors,
      );
    }
    return result;
  };

  const converse = async <T>(
    prompt: string,
    what: "questions" | "plan",
    parse: (text: string) => ParseResult<T>,
  ): Promise<T> => {
    let reply = await runTurn(prompt);
    for (let attempt = 1; ; attempt += 1) {
      const parsed = parse(reply.text);
      if (parsed.ok) {
        return parsed.value;
      }
      if (attempt > config.retries.maxPerTask) {
        throw new OrcError(
          "PLAN_INVALID",
          `the planner's ${what} were still invalid after ${config.retries.maxPerTask} repair attempt(s) (spent ~${usd(spent)}):`,
          parsed.issues,
        );
      }
      progress(
        `The ${what} had ${parsed.issues.length} problem(s); asking the planner to fix them ` +
          `(attempt ${attempt} of ${config.retries.maxPerTask}).`,
      );
      reply = await runTurn(repairPrompt(parsed.issues, what));
    }
  };

  // Phase 1: questions.
  progress("Asking the planner for clarifying questions…");
  const questions = await converse(
    questionsPrompt({ ideaFile: options.idea.file, idea: options.idea.text, rules }),
    "questions",
    parseQuestions,
  );
  if (questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    warnings.push(
      `the planner asked ${questions.length} questions (expected ${MIN_QUESTIONS}-${MAX_QUESTIONS})`,
    );
  }

  const answers: AnsweredQuestion[] = [];
  for (const [index, question] of questions.entries()) {
    const raw = (await options.ask(question, index, questions.length))?.trim() ?? "";
    const usedDefault = raw === "";
    const fallback = question.default === "" ? NO_PREFERENCE : question.default;
    answers.push({ ...question, answer: usedDefault ? fallback : raw, usedDefault });
  }
  // Saved before the expensive turn, so answers survive a failed or interrupted plan.
  await writeFileAtomic(
    vaultFile(vault, PLAN_FILES.questions),
    renderQuestionsNote(answers, options.idea.file, options.now()),
  );

  // Phase 2: the plan, in the same session so the planner keeps the idea and its reasoning.
  progress("Writing the plan…");
  const output = await converse(planPrompt(answers, config.checks), "plan", parsePlanOutput);

  if (options.force) {
    // Stale workstreams from an earlier plan would otherwise become sessions.
    await rm(vaultFile(vault, PLAN_FILES.workstreamsDir), { recursive: true, force: true });
  }
  const written: string[] = [PLAN_FILES.questions];
  for (const [path, content] of output.files) {
    await writeFileAtomic(vaultFile(vault, path), content);
    written.push(path);
  }
  await writeFileAtomic(vaultFile(vault, PLAN_FILES.taskGraph), renderTaskGraph(output.plan));
  written.push(PLAN_FILES.taskGraph);

  const costUsd = roundUsd(spent);
  const taskCount = output.plan.workstreams.reduce((sum, ws) => sum + ws.tasks.length, 0);
  await appendLog(vault, {
    session: PLANNER_SESSION,
    did:
      `wrote plan: ${output.plan.workstreams.length} workstreams, ${taskCount} tasks, ` +
      `${output.plan.contracts.length} contracts (${turns} turns, ~${usd(costUsd)} est.)`,
    touching: [`${VAULT_LAYOUT.planDir}/`, `${VAULT_LAYOUT.contractsDir}/`],
    now: options.now(),
  });

  return {
    plan: output.plan,
    written,
    answers,
    costUsd,
    turns,
    sessionId: sessionId ?? "",
    warnings,
  };
}

function parsePlanOutput(text: string): ParseResult<PlanOutput> {
  const blocks = parseFileBlocks(text);
  if (!blocks.ok) {
    return blocks;
  }
  const plan = parsePlan(blocks.value);
  return plan.ok ? { ok: true, value: { files: blocks.value, plan: plan.value } } : plan;
}

/** True if the vault holds any plan or contract file besides orc's own questions note. */
async function hasPlan(vault: VaultPaths): Promise<boolean> {
  const files = await readPlanFiles(vault);
  return [...files.keys()].some((path) => path !== PLAN_FILES.questions);
}

function vaultFile(vault: VaultPaths, relativePath: string): string {
  return join(vault.root, ...relativePath.split("/"));
}

function renderQuestionsNote(
  answers: readonly AnsweredQuestion[],
  ideaFile: string,
  now: Date,
): string {
  const body = answers
    .map((item, index) => {
      const why = item.why === "" ? "" : `\n*Why:* ${item.why}`;
      const source = item.usedDefault ? " *(planner default)*" : "";
      return `## ${index + 1}. ${item.question}${why}\n**Answer:** ${item.answer}${source}\n`;
    })
    .join("\n");
  // Hand-written frontmatter: `tags` must be a YAML list, which serializeFrontmatter can't express.
  return `---
tags: [plan]
idea: ${JSON.stringify(ideaFile)}
asked: ${JSON.stringify(formatTimestamp(now))}
---
# Clarifying questions

Asked by \`orc plan\` before it wrote the plan. To change an answer, re-run \`orc plan --force\`.

${body}`;
}

function budgetError(spent: number, cap: number): OrcError {
  return new OrcError(
    "BUDGET_EXCEEDED",
    `the planner reached the run cap: ~${usd(spent)} of ${usd(cap)} (maxBudgetUsd in orc.config.json)`,
  );
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}
