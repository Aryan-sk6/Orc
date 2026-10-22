import type { OrcConfig } from "../config/types.js";
import { readFileIfExists } from "../core/fs.js";
import { type Decision, readDecisions } from "../vault/decisions.js";
import type { VaultPaths } from "../vault/layout.js";
import { readSessionNotes, roundUsd, type SessionState } from "../vault/session-note.js";

export interface SessionFacts {
  readonly state: SessionState;
  /** The session note's body (Progress / Problems / Decisions sections), as written. */
  readonly noteBody: string;
}

/** Everything the report says, read from the vault only (decisions, session notes, spend). */
export interface ReportFacts {
  readonly generated: string;
  readonly sessions: readonly SessionFacts[];
  readonly invalidNotes: readonly string[];
  readonly decisions: readonly Decision[];
  readonly spentUsd: number;
  readonly capUsd: number;
}

export async function gatherFacts(
  vault: VaultPaths,
  config: OrcConfig,
  generated: string,
): Promise<ReportFacts> {
  const sessions: SessionFacts[] = [];
  const invalidNotes: string[] = [];
  for (const note of await readSessionNotes(vault)) {
    if (!note.result.ok) {
      invalidNotes.push(`${note.file}: ${note.result.problems.join("; ")}`);
      continue;
    }
    sessions.push({
      state: note.result.state,
      noteBody: stripFrontmatter((await readFileIfExists(note.file)) ?? ""),
    });
  }
  return {
    generated,
    sessions,
    invalidNotes,
    decisions: await readDecisions(vault),
    spentUsd: roundUsd(sessions.reduce((sum, s) => sum + s.state.costUsd, 0)),
    capUsd: config.maxBudgetUsd,
  };
}

/** The deterministic part of the report: sessions, decisions and spend as Markdown tables and lists. */
export function renderFacts(facts: ReportFacts): string {
  const rows = facts.sessions.map(({ state }) =>
    [
      state.session,
      state.status,
      `${state.tasksDone}/${state.tasksTotal}`,
      state.checks.length === 0 ? "-" : state.checks.map((c) => `${c.name} ${c.status}`).join(", "),
      usd(state.costUsd),
    ].join(" | "),
  );
  const sessions =
    rows.length === 0
      ? "No sessions have run yet."
      : `| Session | Status | Tasks | Checks | Cost |\n|---|---|---|---|---|\n${rows.map((row) => `| ${row} |`).join("\n")}`;

  const open = facts.decisions.filter((d) => d.status === "open");
  const resolved = facts.decisions.filter((d) => d.status === "resolved");
  const decision = (d: Decision): string =>
    `- **${d.id}** (${d.session}, ${d.time}): ${d.question}${d.defaultTaken === null ? "" : ` Default taken: ${d.defaultTaken}.`}`;
  const decisions =
    facts.decisions.length === 0
      ? "None."
      : [
          ...(open.length === 0 ? [] : ["Open:", ...open.map(decision)]),
          ...(resolved.length === 0 ? [] : ["Resolved:", ...resolved.map(decision)]),
        ].join("\n");

  const overcount = facts.sessions.some((s) => s.state.costMayBeOvercounted);
  const spend =
    `${usd(facts.spentUsd)} of ${usd(facts.capUsd)} run cap, summed over the session notes ` +
    "(Agent SDK estimate, not billing data; planner and summary spend are not included)." +
    (overcount ? " Spend may be overcounted after a restart." : "");
  const invalid =
    facts.invalidNotes.length === 0
      ? ""
      : `\n\nUnreadable session notes (skipped):\n${facts.invalidNotes.map((n) => `- ${n}`).join("\n")}`;

  return `## Sessions\n\n${sessions}${invalid}\n\n## Decisions\n\n${decisions}\n\n## Spend\n\n${spend}\n`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return text;
  }
  const end = lines.indexOf("---", 1);
  return end === -1 ? text : lines.slice(end + 1).join("\n");
}
