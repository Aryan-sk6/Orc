import { OrcError } from "../core/errors.js";
import { assertSessionName } from "../vault/layout.js";
import { type Env, git, gitOutput } from "./git.js";
import { type Repo, workstreamBranch } from "./worktrees.js";

/*
 * Checkpoints are lightweight git tags made before each task: refs/tags/orc-cp/<workstream>/<task>.
 * Tags are shared by all worktrees of a repo, so `orc rewind` can find them from anywhere.
 * A task that is checkpointed again at a different commit (after a retry or a rewind) gets
 * "<task>.2", "<task>.3", ... so older checkpoints are never moved.
 */

export const CHECKPOINT_TAG_PREFIX = "orc-cp/";
export const BACKUP_TAG_PREFIX = "orc-backup/";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CHECKPOINT_ID = /^([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\.(\d+))?$/;

export interface Checkpoint {
  /** What the user types for `orc rewind`, e.g. "api/T3" or "api/T3.2". */
  readonly id: string;
  readonly tag: string;
  readonly workstream: string;
  readonly task: string;
  /** 1 for the first checkpoint of a task, 2 for "<task>.2", ... */
  readonly attempt: number;
  readonly commit: string;
}

/** A worktree to act in: its path and the env for git. */
export interface WorktreeRef {
  readonly path: string;
  readonly env: Env;
}

/**
 * Commits everything in the worktree (including new files) as orc's bookkeeping commit.
 * Hooks are skipped: these are work-in-progress snapshots on orc's own branch; orc runs
 * the real checks itself. Returns the new commit, or null if there was nothing to commit.
 */
export async function commitAll(worktree: WorktreeRef, message: string): Promise<string | null> {
  const run = { cwd: worktree.path, env: worktree.env };
  await git(["add", "--all"], run);
  const staged = await git(["diff", "--cached", "--quiet"], { ...run, okExitCodes: [1] });
  if (staged.exitCode === 0) {
    return null;
  }
  try {
    await git(["commit", "--quiet", "--no-verify", "-m", message], run);
  } catch (error) {
    if (
      error instanceof OrcError &&
      /identity unknown|tell me who you are|no email was given/i.test(
        [error.message, ...error.details].join("\n"),
      )
    ) {
      throw new OrcError(
        "GIT_FAILED",
        'git has no identity for commits. Run: git config user.name "…" && git config user.email "…"',
        [error.message, ...error.details],
      );
    }
    throw error;
  }
  return gitOutput(["rev-parse", "HEAD"], run);
}

/**
 * Saves pending work (if any), then tags HEAD as the checkpoint before `task`.
 * Idempotent: if this task already has a checkpoint at HEAD, that one is returned.
 */
export async function createCheckpoint(
  worktree: WorktreeRef,
  options: { readonly workstream: string; readonly task: string },
): Promise<{ checkpoint: Checkpoint; savedWork: boolean }> {
  const { workstream, task } = options;
  assertSessionName(workstream);
  if (!TASK_ID.test(task)) {
    throw new OrcError("GIT_FAILED", `invalid task id "${task}" for a checkpoint tag`);
  }
  const run = { cwd: worktree.path, env: worktree.env };
  const saved = await commitAll(worktree, `orc(${workstream}): save work before ${task}`);
  const head = await gitOutput(["rev-parse", "HEAD"], run);

  const existing = (await readCheckpoints(run, `${CHECKPOINT_TAG_PREFIX}${workstream}/`)).filter(
    (cp) => cp.task === task,
  );
  const atHead = existing.find((cp) => cp.commit === head);
  if (atHead !== undefined) {
    return { checkpoint: atHead, savedWork: saved !== null };
  }
  const attempt = Math.max(0, ...existing.map((cp) => cp.attempt)) + 1;
  const id = `${workstream}/${task}${attempt === 1 ? "" : `.${attempt}`}`;
  const tag = `${CHECKPOINT_TAG_PREFIX}${id}`;
  await git(["tag", tag, head], run);
  return {
    checkpoint: { id, tag, workstream, task, attempt, commit: head },
    savedWork: saved !== null,
  };
}

/** All checkpoints (or one workstream's), ordered by workstream, task number and attempt. */
export async function listCheckpoints(repo: Repo, workstream?: string): Promise<Checkpoint[]> {
  if (workstream !== undefined) {
    assertSessionName(workstream);
  }
  const prefix = `${CHECKPOINT_TAG_PREFIX}${workstream === undefined ? "" : `${workstream}/`}`;
  const checkpoints = await readCheckpoints({ cwd: repo.root, env: repo.env }, prefix);
  return checkpoints.sort(
    (a, b) =>
      a.workstream.localeCompare(b.workstream) ||
      a.task.localeCompare(b.task, undefined, { numeric: true }) ||
      a.attempt - b.attempt,
  );
}

export async function findCheckpoint(repo: Repo, id: string): Promise<Checkpoint> {
  const match = CHECKPOINT_ID.exec(id);
  const workstream = match?.[1];
  const found =
    workstream === undefined
      ? undefined
      : (await listCheckpoints(repo, workstream)).find((cp) => cp.id === id);
  if (found === undefined) {
    throw new OrcError(
      "CHECKPOINT_NOT_FOUND",
      `no checkpoint "${id}". Checkpoint ids look like "<workstream>/<task>", e.g. "api/T3".`,
    );
  }
  return found;
}

/**
 * Resets a workstream's worktree to a checkpoint. Current work is first committed and tagged
 * orc-backup/<workstream>/<n>, so a rewind can itself be undone. Ignored files (node_modules,
 * build output) are kept; untracked files are removed after being saved in the backup commit.
 */
export async function rewindToCheckpoint(
  worktree: WorktreeRef,
  checkpoint: Checkpoint,
): Promise<{ backupTag: string }> {
  const run = { cwd: worktree.path, env: worktree.env };
  const current = await gitOutput(["symbolic-ref", "--quiet", "HEAD"], run).catch(() => "");
  const expected = `refs/heads/${workstreamBranch(checkpoint.workstream)}`;
  if (current !== expected) {
    throw new OrcError(
      "WORKTREE_CONFLICT",
      `${worktree.path} is on ${current || "a detached HEAD"}, not ${expected}; refusing to rewind it`,
    );
  }

  await commitAll(
    worktree,
    `orc(${checkpoint.workstream}): save work before rewind to ${checkpoint.id}`,
  );
  const backups = await gitOutput(
    ["tag", "--list", `${BACKUP_TAG_PREFIX}${checkpoint.workstream}/*`],
    run,
  );
  const numbers = backups
    .split("\n")
    .map((tag) => Number(tag.slice(tag.lastIndexOf("/") + 1)))
    .filter((n) => Number.isSafeInteger(n));
  const backupTag = `${BACKUP_TAG_PREFIX}${checkpoint.workstream}/${Math.max(0, ...numbers) + 1}`;
  await git(["tag", backupTag, "HEAD"], run);

  await git(["reset", "--quiet", "--hard", checkpoint.commit], run);
  await git(["clean", "--quiet", "-d", "--force"], run);
  return { backupTag };
}

async function readCheckpoints(
  run: { readonly cwd: string; readonly env: Env },
  prefix: string,
): Promise<Checkpoint[]> {
  const out = await gitOutput(
    ["for-each-ref", "--format=%(refname:strip=2) %(objectname)", `refs/tags/${prefix}`],
    run,
  );
  const checkpoints: Checkpoint[] = [];
  for (const line of out.split("\n")) {
    const [tag, commit] = line.split(" ");
    const match = CHECKPOINT_ID.exec(tag?.slice(CHECKPOINT_TAG_PREFIX.length) ?? "");
    const workstream = match?.[1];
    const task = match?.[2];
    if (
      tag === undefined ||
      commit === undefined ||
      workstream === undefined ||
      task === undefined
    ) {
      continue;
    }
    checkpoints.push({
      id: tag.slice(CHECKPOINT_TAG_PREFIX.length),
      tag,
      workstream,
      task,
      attempt: match?.[3] === undefined ? 1 : Number(match[3]),
      commit,
    });
  }
  return checkpoints;
}
