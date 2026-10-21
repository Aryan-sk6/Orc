import { VAULT_LAYOUT } from "../vault/layout.js";
import { type ParseResult, PLAN_FILES } from "../vault/plan.js";

/*
 * How `orc plan` exchanges data with the planner model. This is CLI-only: the shared
 * prompt file (kit/prompts/planner.md) says WHAT to produce; this says how to send it
 * back so orc can validate everything before writing a single file.
 */

export interface PlannerQuestion {
  readonly question: string;
  readonly why: string;
  /** The reversible default the planner would pick; used when the user gives no answer. */
  readonly default: string;
}

export const MIN_QUESTIONS = 10;
export const MAX_QUESTIONS = 15;
/** Hard limit; between MAX_QUESTIONS and this, orc warns but carries on. */
const QUESTION_LIMIT = 20;

export const QUESTIONS_PROTOCOL = `Reply with one fenced \`json\` block and nothing else:

\`\`\`json
{"questions": [{"question": "…", "why": "…", "default": "…"}]}
\`\`\``;

const OPEN = /^<<<orc-file path="([^"]*)">>>\s*$/;
const CLOSE = /^<<<orc-end>>>\s*$/;

export const FILES_PROTOCOL = `Send every file as a block, with nothing between blocks:

<<<orc-file path="plan/architecture.md">>>
…file content…
<<<orc-end>>>

Paths are relative to the vault and must start with \`plan/\` or \`contracts/\`. Send the complete set of files every time: anything you leave out is treated as missing.`;

/** Extracts the questions JSON (the last ```json block, or the whole reply). */
export function parseQuestions(text: string): ParseResult<readonly PlannerQuestion[]> {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const json = fences.at(-1)?.[1] ?? text.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, issues: ["the reply has no valid ```json block with the questions"] };
  }
  const list = isObject(raw) ? raw["questions"] : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, issues: ['the JSON must be {"questions": [...]} with at least one item'] };
  }
  if (list.length > QUESTION_LIMIT) {
    return { ok: false, issues: [`ask at most ${MAX_QUESTIONS} questions, not ${list.length}`] };
  }

  const issues: string[] = [];
  const questions: PlannerQuestion[] = [];
  list.forEach((item: unknown, index) => {
    const question = isObject(item) ? item["question"] : undefined;
    if (!isObject(item) || typeof question !== "string" || question.trim() === "") {
      issues.push(`questions[${index}] needs a non-empty "question" string`);
      return;
    }
    questions.push({
      question: question.trim(),
      why: stringOr(item["why"]),
      default: stringOr(item["default"]),
    });
  });
  return issues.length === 0 ? { ok: true, value: questions } : { ok: false, issues };
}

/** Parses `<<<orc-file>>>` blocks into vault-relative path → content. Text outside blocks is ignored. */
export function parseFileBlocks(text: string): ParseResult<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  const issues: string[] = [];
  let current: { path: string; lines: string[] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const open = OPEN.exec(line);
    if (current === null) {
      if (open !== null) {
        current = { path: open[1] ?? "", lines: [] };
      }
      continue;
    }
    if (CLOSE.test(line)) {
      addFile(files, current.path, current.lines, issues);
      current = null;
    } else if (open !== null) {
      issues.push(`file block "${current.path}" is not closed before "${open[1] ?? ""}" starts`);
      current = { path: open[1] ?? "", lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current !== null) {
    issues.push(`file block "${current.path}" is missing its closing <<<orc-end>>> line`);
  }
  if (files.size === 0 && issues.length === 0) {
    issues.push("the reply contains no <<<orc-file>>> blocks");
  }
  return issues.length === 0 ? { ok: true, value: files } : { ok: false, issues };
}

/** orc writes these itself; the model may not. */
const ORC_OWNED: readonly string[] = [PLAN_FILES.questions, PLAN_FILES.taskGraph];

function addFile(
  files: Map<string, string>,
  path: string,
  lines: readonly string[],
  issues: string[],
): void {
  const problem = pathProblem(path);
  if (problem !== null) {
    issues.push(`"${path}": ${problem}`);
    return;
  }
  if (files.has(path)) {
    issues.push(`"${path}" was sent twice`);
    return;
  }
  const content = lines.join("\n").replace(/\n*$/, "\n");
  files.set(path, content);
}

/** Vault-relative, "/"-separated, inside plan/ or contracts/, no traversal. */
export function pathProblem(path: string): string | null {
  const segments = path.split("/");
  if (path === "" || path.includes("\\") || path.startsWith("/")) {
    return "must be a relative path with forward slashes";
  }
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "must not contain empty, '.' or '..' segments";
  }
  if (segments[0] !== VAULT_LAYOUT.planDir && segments[0] !== VAULT_LAYOUT.contractsDir) {
    return "must be inside plan/ or contracts/";
  }
  if (segments.length < 2) {
    return "must name a file inside the folder";
  }
  if (ORC_OWNED.includes(path)) {
    return "is written by orc, not the planner";
  }
  return null;
}

function stringOr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
