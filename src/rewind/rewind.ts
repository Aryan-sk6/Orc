import { OrcError } from "../core/errors.js";
import { SessionRecorder } from "../driver/recorder.js";
import { findCheckpoint, rewindToCheckpoint } from "../git/checkpoints.js";
import type { Env } from "../git/git.js";
import { gitOutput } from "../git/git.js";
import { integrationBranchesContaining } from "../git/integration.js";
import { defaultWorktreesDir, ensureWorktree, type Repo } from "../git/worktrees.js";
import type { VaultPaths } from "../vault/layout.js";
import { appendLog, formatTimestamp } from "../vault/log.js";
import { markTasksUndoneFrom, type Plan, parsePlan, readPlanFiles } from "../vault/plan.js";
import { readSessionNotes, type SessionState } from "../vault/session-note.js";

/** Run-level LOG lines use this session name, like `orc run` (src/driver/run.ts). */
const LOG_SESSION = "orc";

export interface RewindOptions {
  readonly vault: VaultPaths;
  readonly repo: Repo;
  /** What the user typed, e.g. "api/T3" or "api/T3.2". */
  readonly checkpointId: string;
  /** Rewind even if the session's note says it is running (e.g. orc was killed). */
  readonly force?: boolean | undefined;
  readonly env: Env;
  readonly now: () => Date;
}

export interface RewindResult {
  readonly checkpoint: string;
  readonly workstream: string;
  readonly worktreePath: string;
  /** Tag holding the work that was discarded; `git reset --hard` to it undoes the rewind. */
  readonly backupTag: string;
  /** Tasks unticked in the workstream note, in file order. */
  readonly undoneTasks: readonly string[];
  readonly tasksDone: number;
  /** Finished tasks in OTHER workstreams that were built on a task that is now undone. */
  readonly dependentTasks: readonly string[];
  /** Integration branches that still contain the discarded work. */
  readonly integrationBranches: readonly string[];
}

/**
 * `orc rewind <checkpoint>`: puts a workstream's worktree back to the commit tagged before a task,
 * unticks that task and every later one in the plan, and resets the session note so the next
 * `orc run` starts the task again. The discarded work is kept under an orc-backup/ tag.
 */
export async function rewindWorkstream(options: RewindOptions): Promise<RewindResult> {
  const { vault, repo } = options;
  const checkpoint = await findCheckpoint(repo, options.checkpointId);

  const parsed = parsePlan(await readPlanFiles(vault));
  if (!parsed.ok) {
    throw new OrcError("PLAN_INVALID", "the plan in the vault is not valid:", parsed.issues);
  }
  const workstream = parsed.value.workstreams.find((ws) => ws.name === checkpoint.workstream);
  if (workstream === undefined || !workstream.tasks.some((task) => task.id === checkpoint.task)) {
    throw new OrcError(
      "CHECKPOINT_NOT_FOUND",
      `checkpoint ${checkpoint.id} does not match a task in the plan (${checkpoint.workstream}/${checkpoint.task})`,
    );
  }

  const saved = (await readSessionNotes(vault)).find((note) => note.name === workstream.name);
  const previous = saved?.result.ok === true ? saved.result.state : null;
  if (
    options.force !== true &&
    previous !== null &&
    (previous.status === "running" || previous.status === "checking")
  ) {
    throw new OrcError(
      "REWIND_BLOCKED",
      `session ${workstream.name} is marked ${previous.status}: an "orc run" may still be using its worktree. ` +
        "Stop it (Ctrl-C) first, or pass --force if orc was killed.",
    );
  }

  const { worktree } = await ensureWorktree(repo, {
    name: workstream.name,
    worktreesDir: defaultWorktreesDir(repo.root),
  });
  const discarded = await gitOutput(["rev-parse", "HEAD"], {
    cwd: worktree.path,
    env: options.env,
  });
  const { backupTag } = await rewindToCheckpoint(
    { path: worktree.path, env: options.env },
    checkpoint,
  );
  const undoneTasks = await markTasksUndoneFrom(vault, workstream.name, checkpoint.task);

  const after = parsePlan(await readPlanFiles(vault));
  const plan: Plan = after.ok ? after.value : parsed.value;
  const tasksDone =
    plan.workstreams.find((ws) => ws.name === workstream.name)?.tasks.filter((t) => t.done)
      .length ?? 0;
  const undoneRefs = new Set(undoneTasks.map((id) => `${workstream.name}/${id}`));
  const dependentTasks = plan.workstreams
    .filter((ws) => ws.name !== workstream.name)
    .flatMap((ws) => ws.tasks)
    .filter((task) => task.done && task.needs.some((ref) => undoneRefs.has(ref)))
    .map((task) => task.ref);

  // The old agent conversation remembers the discarded work, so the next run starts a fresh one.
  const recorder = new SessionRecorder(
    vault,
    previous ?? freshState(workstream.name, worktree.branch, workstream.tasks.length, options.now),
    options.now,
  );
  await recorder.update({
    status: "pending",
    currentTask: null,
    tasksDone,
    tasksTotal: workstream.tasks.length,
    checks: [],
    agentSession: null,
  });
  const did = `rewound ${workstream.name} to ${checkpoint.id} (backup ${backupTag}); unticked ${undoneTasks.join(", ") || "nothing"}`;
  await recorder.note("Progress", did);
  await appendLog(vault, { session: LOG_SESSION, did, now: options.now() });

  return {
    checkpoint: checkpoint.id,
    workstream: workstream.name,
    worktreePath: worktree.path,
    backupTag,
    undoneTasks,
    tasksDone,
    dependentTasks,
    integrationBranches: await integrationBranchesContaining(repo, discarded),
  };
}

function freshState(
  workstream: string,
  branch: string,
  tasksTotal: number,
  now: () => Date,
): SessionState {
  return {
    session: workstream,
    workstream,
    branch,
    status: "pending",
    currentTask: null,
    tasksDone: 0,
    tasksTotal,
    checks: [],
    costUsd: 0,
    agentSession: null,
    costMayBeOvercounted: false,
    updated: formatTimestamp(now()),
  };
}
