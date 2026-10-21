import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CheckCommand } from "../config/types.js";
import { errorMessage, OrcError } from "../core/errors.js";
import { FILES_PROTOCOL, type PlannerQuestion, QUESTIONS_PROTOCOL } from "./protocol.js";

/** The shared planner prompt. Same relative path from src/planner/ (tests) and dist/planner/. */
export const PLANNER_PROMPT_PATH = fileURLToPath(
  new URL("../../kit/prompts/planner.md", import.meta.url),
);

export async function loadPlannerPrompt(path: string = PLANNER_PROMPT_PATH): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new OrcError(
      "PROMPT_NOT_FOUND",
      `cannot read the planner prompt ${path}: ${errorMessage(error)}`,
    );
  }
}

export interface AnsweredQuestion extends PlannerQuestion {
  readonly answer: string;
  /** True when the user gave no answer and the planner's default was used. */
  readonly usedDefault: boolean;
}

export interface QuestionsPromptInput {
  readonly ideaFile: string;
  readonly idea: string;
  /** Contents of the vault's rules.md, or "" when there is none. */
  readonly rules: string;
}

export function questionsPrompt(input: QuestionsPromptInput): string {
  const rules =
    input.rules.trim() === ""
      ? ""
      : `\nThe user's standing rules (vault/rules.md) apply to the plan:\n\n${input.rules.trim()}\n`;
  return `# Phase 1: clarifying questions

The app idea, from ${input.ideaFile}:

${input.idea.trim()}
${rules}
Ask your clarifying questions now. ${QUESTIONS_PROTOCOL}
`;
}

export function planPrompt(
  answers: readonly AnsweredQuestion[],
  checks: readonly CheckCommand[],
): string {
  const qa = answers
    .map((item, index) => {
      const note = item.usedDefault ? " (your default; the user had no preference)" : "";
      return `${index + 1}. ${item.question}\n   Answer: ${item.answer}${note}`;
    })
    .join("\n");
  const commands =
    checks.length === 0
      ? "orc runs no check commands."
      : checks.map((check) => `- ${check.name}: \`${check.command}\``).join("\n");
  return `# Phase 2: write the plan

The user's answers:

${qa}

After every coding turn, orc runs these checks in the app, in order. The target agents.md and the scaffolding task must make them work:

${commands}

Write the complete plan now. ${FILES_PROTOCOL}
`;
}

export function repairPrompt(issues: readonly string[], what: "questions" | "plan"): string {
  const list = issues.map((issue) => `- ${issue}`).join("\n");
  const resend =
    what === "questions"
      ? `Send the questions again. ${QUESTIONS_PROTOCOL}`
      : `Send the complete, corrected set of files again, not just the changed ones. ${FILES_PROTOCOL}`;
  return `orc could not use your last reply:

${list}

${resend}
`;
}
