import { stat } from "node:fs/promises";
import { loadConfig } from "../../config/load.js";
import { errorCode, OrcError } from "../../core/errors.js";
import { readDecisions } from "../../vault/decisions.js";
import { vaultPaths } from "../../vault/layout.js";
import {
  type CheckSummary,
  readSessionNotes,
  type SessionState,
} from "../../vault/session-note.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export interface StatusReport {
  readonly vaultPath: string;
  readonly sessions: readonly SessionState[];
  readonly invalidNotes: readonly { readonly file: string; readonly problems: readonly string[] }[];
  readonly openDecisions: number;
  readonly tokensSpent: number;
  readonly perRunTokens: number;
}

export const statusCommand: Command = {
  name: "status",
  summary: "Show each session's status, current task, checks and tokens spent",
  help: `Usage: orc status [--json]

Reads <vault>/sessions/*.md and <vault>/decisions.md. Nothing is cached:
the vault is the only source of truth.

Options:
  --json    Print the report as JSON
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { json: { type: "boolean" } });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const report = await buildStatusReport(loaded.vaultPath, loaded.config.budgets.perRunTokens);

    if (values.json === true) {
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      io.stdout(renderStatus(report));
    }
    for (const note of report.invalidNotes) {
      io.stderr(`orc: skipped ${note.file}:\n${note.problems.map((p) => `  - ${p}\n`).join("")}`);
    }
    return 0;
  },
};

export async function buildStatusReport(
  vaultPath: string,
  perRunTokens: number,
): Promise<StatusReport> {
  await assertDirectory(vaultPath);
  const paths = vaultPaths(vaultPath);
  const [notes, decisions] = await Promise.all([readSessionNotes(paths), readDecisions(paths)]);

  const sessions: SessionState[] = [];
  const invalidNotes: { file: string; problems: readonly string[] }[] = [];
  for (const note of notes) {
    if (note.result.ok) {
      sessions.push(note.result.state);
    } else {
      invalidNotes.push({ file: note.file, problems: note.result.problems });
    }
  }
  return {
    vaultPath,
    sessions,
    invalidNotes,
    openDecisions: decisions.filter((decision) => decision.status === "open").length,
    tokensSpent: sessions.reduce((sum, session) => sum + session.tokensSpent, 0),
    perRunTokens,
  };
}

export function renderStatus(report: StatusReport): string {
  if (report.sessions.length === 0) {
    return `No sessions yet in ${report.vaultPath}/sessions.\n`;
  }
  const table = renderTable(
    [
      { header: "SESSION" },
      { header: "STATUS" },
      { header: "TASK", maxWidth: 40 },
      { header: "DONE", align: "right" },
      { header: "CHECKS" },
      { header: "TOKENS", align: "right" },
      { header: "UPDATED" },
    ],
    report.sessions.map((session) => [
      session.session,
      session.status,
      session.currentTask ?? "-",
      `${session.tasksDone}/${session.tasksTotal}`,
      formatChecksCell(session.checks),
      formatNumber(session.tokensSpent),
      session.updated,
    ]),
  );
  const share = report.perRunTokens > 0 ? (report.tokensSpent / report.perRunTokens) * 100 : 0;
  const decisions =
    report.openDecisions === 0
      ? "Open decisions: 0"
      : `Open decisions: ${report.openDecisions} (see decisions.md)`;
  return (
    `${table}\n\n` +
    `Tokens: ${formatNumber(report.tokensSpent)} of ${formatNumber(report.perRunTokens)} run cap ` +
    `(${share.toFixed(1)}%)\n${decisions}\n`
  );
}

/** "-" before any check ran, "fail: lint, test" when something failed, otherwise "3/4 pass". */
export function formatChecksCell(checks: readonly CheckSummary[]): string {
  if (checks.length === 0) {
    return "-";
  }
  const failed = checks.filter((check) => check.status === "fail").map((check) => check.name);
  if (failed.length > 0) {
    return `fail: ${failed.join(", ")}`;
  }
  const passed = checks.filter((check) => check.status === "pass").length;
  return `${passed}/${checks.length} pass`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

async function assertDirectory(path: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) {
      return;
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  throw new OrcError(
    "VAULT_NOT_FOUND",
    `no vault at ${path}. Set "vaultDir" in orc.config.json, or run "orc plan" first.`,
  );
}
