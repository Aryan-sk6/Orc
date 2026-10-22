import type { AgentAdapter, AgentTurnResult } from "../agents/adapter.js";
import type { OrcConfig } from "../config/types.js";
import { errorMessage, OrcError } from "../core/errors.js";
import { writeFileAtomic } from "../core/fs.js";
import { serializeFrontmatter } from "../vault/frontmatter.js";
import type { VaultPaths } from "../vault/layout.js";
import { appendLog, formatTimestamp, readLogTail } from "../vault/log.js";
import {
  readSessionNotes,
  roundUsd,
  SUMMARY_SESSION,
  writeSessionState,
} from "../vault/session-note.js";
import { gatherFacts, renderFacts } from "./facts.js";
import { summaryPrompt, summaryRepairPrompt, validateSummary } from "./prompts.js";

/** LOG lines of the run-level orchestrator, same name as `orc run` uses. */
const LOG_SESSION = "orc";
/** The model sees this many LOG lines. */
export const SUMMARY_LOG_LINES = 60;

export interface SummarizeOptions {
  /** null: write the facts only, no model call. */
  readonly adapter: AgentAdapter | null;
  readonly config: OrcConfig;
  readonly vault: VaultPaths;
  /** The target app's root: where the read-only model call runs. */
  readonly rootDir: string;
  /** Contents of kit/prompts/summary.md. */
  readonly systemPrompt: string;
  readonly now: () => Date;
  readonly signal?: AbortSignal | undefined;
}

export interface SummarizeResult {
  readonly reportPath: string;
  /** True if the model wrote the narrative sections. */
  readonly narrative: boolean;
  /** Why there is no narrative; null when there is one. */
  readonly reason: string | null;
  readonly costUsd: number;
}

/**
 * `orc summarize`: reads every session note, the decisions and the log, and writes
 * <vault>/report.md. The facts (sessions, decisions, spend) are rendered deterministically; one
 * read-only call on the small driver model adds the narrative on top. If the model cannot be
 * used (no adapter, bad replies), the report is still written, without it.
 */
export async function runSummary(options: SummarizeOptions): Promise<SummarizeResult> {
  const { config, vault } = options;
  const facts = await gatherFacts(vault, config, formatTimestamp(options.now()));

  let narrative: string | null = null;
  let reason: string | null = null;
  let costUsd = 0;
  // A fixed cap per call, apart from the run cap: summary spend never draws from maxBudgetUsd.
  const cap = config.summaryBudgetUsd;

  if (options.adapter === null) {
    reason = "facts only (--facts-only)";
  } else {
    const logTail = await readLogTail(vault, SUMMARY_LOG_LINES);
    let prompt = summaryPrompt(facts, logTail);
    let resume: string | undefined;
    for (let repairs = 0; ; repairs += 1) {
      const left = cap - costUsd;
      if (left <= 0) {
        reason = `the summary cap of $${cap} was reached while repairing the reply`;
        break;
      }
      const turn = await callModel(options, options.adapter, {
        prompt,
        resume,
        maxBudgetUsd: left,
      });
      costUsd += turn.costUsd;
      if (turn.outcome !== "success") {
        reason = `the model call ended with ${turn.outcome}${turn.errors.length === 0 ? "" : ` (${turn.errors.join("; ")})`}`;
        break;
      }
      const checked = validateSummary(turn.text);
      if (checked.ok) {
        narrative = checked.value;
        break;
      }
      if (repairs >= config.retries.maxPerTask || options.signal?.aborted === true) {
        reason = `the model's reply was unusable: ${checked.issues.join("; ")}`;
        break;
      }
      resume = turn.sessionId;
      prompt = summaryRepairPrompt(checked.issues);
    }
  }

  if (options.adapter !== null) {
    await recordSummarySpend(options, costUsd);
  }
  // Read again so the spend table includes this call.
  const body =
    `# Run report\n\n` +
    (narrative === null ? `_No narrative: ${reason}._\n\n` : `${narrative}\n\n`) +
    renderFacts(await gatherFacts(vault, config, facts.generated));
  await writeFileAtomic(
    vault.report,
    serializeFrontmatter(
      {
        tags: "report",
        generated: facts.generated,
        narrative: narrative !== null,
        summaryCostUsd: roundUsd(costUsd),
      },
      body,
    ),
  );
  await appendLog(vault, {
    session: LOG_SESSION,
    did: `summarize: wrote report.md (${narrative === null ? `no narrative: ${reason}` : "with narrative"}, ~$${roundUsd(costUsd)})`,
    touching: [vault.report],
    now: options.now(),
  });
  return {
    reportPath: vault.report,
    narrative: narrative !== null,
    reason,
    costUsd: roundUsd(costUsd),
  };
}

/** Adds this call's cost to the `summarize` session note, so `orc status` shows it. */
async function recordSummarySpend(options: SummarizeOptions, costUsd: number): Promise<void> {
  const previous = (await readSessionNotes(options.vault)).find(
    (note) => note.name === SUMMARY_SESSION,
  );
  const before = previous?.result.ok === true ? previous.result.state.costUsd : 0;
  await writeSessionState(options.vault, {
    session: SUMMARY_SESSION,
    workstream: SUMMARY_SESSION,
    branch: "none",
    status: "done",
    currentTask: null,
    tasksDone: 0,
    tasksTotal: 0,
    checks: [],
    costUsd: roundUsd(before + costUsd),
    agentSession: null,
    costMayBeOvercounted: false,
    updated: formatTimestamp(options.now()),
  });
}

/** A backend that cannot run at all becomes an "error" turn; anything else is a bug and propagates. */
async function callModel(
  options: SummarizeOptions,
  adapter: AgentAdapter,
  call: {
    readonly prompt: string;
    readonly resume: string | undefined;
    readonly maxBudgetUsd: number;
  },
): Promise<AgentTurnResult> {
  const request = {
    prompt: call.prompt,
    cwd: options.rootDir,
    model: options.config.driver.model,
    systemPrompt: options.systemPrompt,
    resumeSessionId: call.resume,
    access: "read-only" as const,
    projectRoot: options.rootDir,
    maxBudgetUsd: call.maxBudgetUsd,
    signal: options.signal,
  };
  try {
    return await adapter.runTurn(request);
  } catch (error) {
    if (error instanceof OrcError && error.code === "AGENT_FAILED") {
      return {
        sessionId: call.resume ?? "",
        outcome: "error",
        text: "",
        costUsd: 0,
        durationMs: 0,
        errors: [errorMessage(error)],
        deniedActions: [],
      };
    }
    throw error;
  }
}
