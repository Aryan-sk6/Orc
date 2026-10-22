import { stat } from "node:fs/promises";
import { loadConfig } from "../../config/load.js";
import { errorCode, OrcError } from "../../core/errors.js";
import { readDecisions } from "../../vault/decisions.js";
import { vaultPaths } from "../../vault/layout.js";
import {
  type CheckSummary,
  readSessionNotes,
  roundUsd,
  type SessionState,
  SUMMARY_SESSION,
} from "../../vault/session-note.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export interface StatusReport {
  readonly vaultPath: string;
  readonly sessions: readonly SessionState[];
  readonly invalidNotes: readonly { readonly file: string; readonly problems: readonly string[] }[];
  readonly openDecisions: number;
  /** Sum of the sessions' `costUsd`: an estimate from the Agent SDK, not billing data. */
  readonly costUsd: number;
  readonly maxBudgetUsd: number;
  /** Spent by `orc summarize` calls: kept apart from `costUsd` and the run cap. */
  readonly summaryCostUsd: number;
  readonly summaryBudgetUsd: number;
}

export const statusCommand: Command = {
  name: "status",
  summary: "Show each session's status, current task, checks and estimated spend",
  help: `Usage: orc status [--json]

Reads <vault>/sessions/*.md and <vault>/decisions.md. Nothing is cached:
the vault is the only source of truth.

Spend is the Agent SDK's client-side estimate (total_cost_usd per call),
not billing data. Check the Claude Console for actual billing.

Options:
  --json    Print the report as JSON
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { json: { type: "boolean" } });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const report = await buildStatusReport(
      loaded.vaultPath,
      loaded.config.maxBudgetUsd,
      loaded.config.summaryBudgetUsd,
    );

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
  maxBudgetUsd: number,
  summaryBudgetUsd: number,
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
    costUsd: roundUsd(sumCost(sessions.filter((session) => session.session !== SUMMARY_SESSION))),
    maxBudgetUsd,
    summaryCostUsd: roundUsd(
      sumCost(sessions.filter((session) => session.session === SUMMARY_SESSION)),
    ),
    summaryBudgetUsd,
  };
}

function sumCost(sessions: readonly SessionState[]): number {
  return sessions.reduce((sum, session) => sum + session.costUsd, 0);
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
      { header: "COST", align: "right" },
      { header: "UPDATED" },
    ],
    report.sessions.map((session) => [
      session.session,
      session.status,
      session.currentTask ?? "-",
      `${session.tasksDone}/${session.tasksTotal}`,
      formatChecksCell(session.checks),
      formatUsd(session.costUsd),
      session.updated,
    ]),
  );
  const share = (report.costUsd / report.maxBudgetUsd) * 100;
  const decisions =
    report.openDecisions === 0
      ? "Open decisions: 0"
      : `Open decisions: ${report.openDecisions} (see decisions.md)`;
  return (
    `${table}\n\n` +
    `Spend: ${formatUsd(report.costUsd)} of ${formatUsd(report.maxBudgetUsd)} run cap ` +
    `(${share.toFixed(1)}%), estimated by the Agent SDK, not billing data\n${summaryLine(report)}${decisions}\n${overcountNote(report.sessions)}`
  );
}

function summaryLine(report: StatusReport): string {
  return report.sessions.some((session) => session.session === SUMMARY_SESSION)
    ? `Summary: ${formatUsd(report.summaryCostUsd)} so far, capped at ${formatUsd(report.summaryBudgetUsd)} per call, separate from the run cap\n`
    : "";
}

function overcountNote(sessions: readonly SessionState[]): string {
  const names = sessions.filter((s) => s.costMayBeOvercounted).map((s) => s.session);
  return names.length === 0
    ? ""
    : `Spend may be overcounted after a restart (${names.join(", ")}): resumed sessions can recount their saved total\n`;
}

/** `$1.23`; amounts that would round to $0.00 show as `<$0.01` so cheap driver calls stay visible. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) {
    return "<$0.01";
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
