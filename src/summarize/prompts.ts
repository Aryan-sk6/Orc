import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorMessage, OrcError } from "../core/errors.js";
import { clip } from "../driver/context.js";
import { formatLogLine, type LogEntry } from "../vault/log.js";
import { type ReportFacts, renderFacts } from "./facts.js";

/** The shared summary prompt. Same relative path from src/summarize/ (tests) and dist/summarize/. */
export const SUMMARY_PROMPT_PATH = fileURLToPath(
  new URL("../../kit/prompts/summary.md", import.meta.url),
);

/** The sections the model must write, in order (kit/prompts/summary.md says the same). */
export const SUMMARY_HEADINGS: readonly string[] = [
  "What was built",
  "What went wrong",
  "Decisions for you",
  "Next steps",
];

const MAX_NOTE_CHARS = 3000;

export async function loadSummaryPrompt(path: string = SUMMARY_PROMPT_PATH): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new OrcError(
      "PROMPT_NOT_FOUND",
      `cannot read the summary prompt ${path}: ${errorMessage(error)}`,
    );
  }
}

export function summaryPrompt(facts: ReportFacts, logTail: readonly LogEntry[]): string {
  const notes = facts.sessions
    .map(
      ({ state, noteBody }) =>
        `### Session note: ${state.session}\n\n${clip(noteBody, MAX_NOTE_CHARS)}`,
    )
    .join("\n\n");
  return `Write the report for this run.

# Facts

${renderFacts(facts)}
# Session notes

${notes === "" ? "(none)" : notes}

# Last log lines

${logTail.length === 0 ? "(empty)" : logTail.map(formatLogLine).join("\n")}

Reply with the four sections now.`;
}

export function summaryRepairPrompt(issues: readonly string[]): string {
  return `orc could not use your last reply:\n\n${issues.map((i) => `- ${i}`).join("\n")}\n\nSend the four sections again: ${SUMMARY_HEADINGS.map((h) => `"## ${h}"`).join(", ")}, in that order, with no code fence around them.`;
}

export type SummaryCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Accepts the reply if it has the four `## ` headings in order; unwraps one stray code fence. */
export function validateSummary(reply: string): SummaryCheck {
  const text = reply
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, "$1")
    .trim();
  const found = [...text.matchAll(/^## (.+?)\s*$/gm)].map((match) => match[1] ?? "");
  const issues: string[] = [];
  let from = 0;
  for (const heading of SUMMARY_HEADINGS) {
    const at = found.indexOf(heading, from);
    if (at === -1) {
      issues.push(
        found.includes(heading)
          ? `"## ${heading}" is out of order`
          : `missing the section "## ${heading}"`,
      );
    } else {
      from = at + 1;
    }
  }
  const extra = found.filter((heading) => !SUMMARY_HEADINGS.includes(heading));
  if (extra.length > 0) {
    issues.push(`unexpected sections: ${extra.map((h) => `"## ${h}"`).join(", ")}`);
  }
  return issues.length === 0 ? { ok: true, value: text } : { ok: false, issues };
}
