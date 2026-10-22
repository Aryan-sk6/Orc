import type { AgentAdapter } from "../agents/adapter.js";
import type { OrcConfig } from "../config/types.js";
import { errorMessage, OrcError } from "../core/errors.js";
import type { Env } from "../git/git.js";
import { defaultWorktreesDir, ensureWorktree, type Repo } from "../git/worktrees.js";
import type { VaultPaths } from "../vault/layout.js";
import { appendLog, formatTimestamp } from "../vault/log.js";
import type { Plan } from "../vault/plan.js";
import { readSessionNotes, roundUsd, type SessionState } from "../vault/session-note.js";
import { TaskBoard } from "./board.js";
import { RunBudget } from "./budget.js";
import { loadSessionContext } from "./context.js";
import { SessionRecorder } from "./recorder.js";
import { runSession, type SessionOutcome } from "./session.js";

/** Session name for run-level LOG lines. */
export const ORC_SESSION = "orc";

export interface RunDriverOptions {
  readonly adapter: AgentAdapter;
  readonly config: OrcConfig;
  readonly vault: VaultPaths;
  /** The main checkout. Worktrees are created next to it (Decisions/0010). */
  readonly repo: Repo;
  readonly plan: Plan;
  /** Contents of kit/prompts/driver.md. */
  readonly driverSystemPrompt: string;
  readonly env: Env;
  readonly now: () => Date;
  /** Run only these workstreams (default: all). Tasks needing others still wait for them. */
  readonly only?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((message: string) => void) | undefined;
}

export interface RunResult {
  readonly sessions: readonly SessionOutcome[];
  /** Estimated USD spent across the whole run cap, including earlier runs. */
  readonly spentUsd: number;
  readonly capUsd: number;
}

/**
 * `orc run`: one worktree and one coding session per workstream, all running at once.
 * Sessions share only the vault and the run budget. A session that pauses or fails does not
 * stop the others. Safe to call again after a pause or a restart: finished tasks (ticked in
 * the workstream notes) are skipped and the agent conversation is resumed.
 */
export async function runDriver(options: RunDriverOptions): Promise<RunResult> {
  const { config, vault, repo, plan } = options;
  const progress = options.onProgress ?? (() => undefined);

  const selected = selectWorkstreams(plan, options.only);
  const notes = await readSessionNotes(vault);
  const saved = new Map<string, SessionState>();
  for (const note of notes) {
    if (note.result.ok) {
      saved.set(note.name, note.result.state);
    } else if (selected.some((ws) => ws.name === note.name)) {
      throw new OrcError(
        "SESSION_NOTE_INVALID",
        `session note ${note.file} is unreadable. Fix or delete it, then run again.`,
        note.result.problems,
      );
    }
  }
  // Earlier runs count against the same cap, for every session, selected or not.
  const budget = new RunBudget(
    config.maxBudgetUsd,
    [...saved.values()].reduce((sum, state) => sum + state.costUsd, 0),
  );

  const board = new TaskBoard(
    plan.workstreams.flatMap((ws) => ws.tasks.filter((t) => t.done).map((t) => t.ref)),
  );

  // Created one at a time: concurrent `git worktree add` calls fight over git's lock files.
  const worktreesDir = defaultWorktreesDir(repo.root);
  const prepared = [];
  for (const workstream of selected) {
    const { worktree, created } = await ensureWorktree(repo, {
      name: workstream.name,
      worktreesDir,
    });
    progress(`[${workstream.name}] ${created ? "created" : "reusing"} worktree ${worktree.path}`);
    const previous = saved.get(workstream.name);
    const done = workstream.tasks.filter((t) => t.done).length;
    const state: SessionState = {
      session: workstream.name,
      workstream: workstream.name,
      branch: worktree.branch,
      status: "pending",
      currentTask: null,
      tasksDone: done,
      tasksTotal: workstream.tasks.length,
      checks: [],
      costUsd: previous?.costUsd ?? 0,
      agentSession: previous?.agentSession ?? null,
      costMayBeOvercounted: previous?.costMayBeOvercounted ?? false,
      updated: formatTimestamp(options.now()),
    };
    const recorder = new SessionRecorder(vault, state, options.now);
    await recorder.update({});
    const context = await loadSessionContext(vault, plan, workstream);
    prepared.push({ workstream, worktree, recorder, context });
  }

  const logRun = (did: string): Promise<unknown> =>
    appendLog(vault, { session: ORC_SESSION, did, now: options.now() });
  await logRun(
    `run started: ${selected.map((ws) => ws.name).join(", ")} (cap $${config.maxBudgetUsd}, ~$${roundUsd(budget.spent)} already spent)`,
  );

  const outcomes = await Promise.all(
    prepared.map(async ({ workstream, worktree, recorder, context }): Promise<SessionOutcome> => {
      try {
        return await runSession({
          adapter: options.adapter,
          config,
          vault,
          worktree,
          repoRoot: repo.root,
          workstream,
          context,
          recorder,
          budget,
          board,
          driverSystemPrompt: options.driverSystemPrompt,
          env: options.env,
          now: options.now,
          signal: options.signal,
          onProgress: progress,
        });
      } catch (error) {
        // A bug or a broken environment stops this session only; the others carry on.
        const reason = `crashed: ${errorMessage(error)}`;
        await recorder.update({ status: "paused" }).catch(() => undefined);
        await recorder.note("Problems", reason).catch(() => undefined);
        await recorder.log(`paused: ${reason}`).catch(() => undefined);
        progress(`[${workstream.name}] paused: ${reason}`);
        return {
          session: workstream.name,
          end: "paused",
          reason,
          tasksDone: recorder.state.tasksDone,
          tasksTotal: workstream.tasks.length,
          costUsd: recorder.state.costUsd,
        };
      } finally {
        board.markStopped(workstream.name);
      }
    }),
  );

  await logRun(
    `run finished: ${outcomes.map((o) => `${o.session} ${o.end}`).join(", ")} (~$${roundUsd(budget.spent)} of $${config.maxBudgetUsd})`,
  );
  return { sessions: outcomes, spentUsd: roundUsd(budget.spent), capUsd: config.maxBudgetUsd };
}

function selectWorkstreams(plan: Plan, only: readonly string[] | undefined): Plan["workstreams"] {
  if (only === undefined || only.length === 0) {
    return plan.workstreams;
  }
  const known = plan.workstreams.map((ws) => ws.name);
  const unknown = only.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new OrcError(
      "USAGE",
      `unknown workstream${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")} (the plan has: ${known.join(", ")})`,
    );
  }
  return plan.workstreams.filter((ws) => only.includes(ws.name));
}
