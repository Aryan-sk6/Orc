import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { OrcError } from "../core/errors.js";
import { assertSessionName } from "../vault/layout.js";
import { type Env, git, gitOutput } from "./git.js";

/*
 * One git worktree + branch per workstream. Worktrees live OUTSIDE the main checkout
 * (a sibling folder by default) so the app's own tools (tsc, vitest, linters) never
 * pick up a second copy of the code. Branches are never deleted by orc.
 */

export const BRANCH_PREFIX = "orc/";

export interface Repo {
  /** Absolute, symlink-resolved root of the main checkout. */
  readonly root: string;
  readonly env: Env;
}

export interface Worktree {
  readonly path: string;
  /** Full ref, e.g. "refs/heads/orc/api"; null when detached. */
  readonly branch: string | null;
  readonly head: string;
}

export interface WorkstreamWorktree {
  readonly name: string;
  readonly path: string;
  /** Short branch name, e.g. "orc/api". */
  readonly branch: string;
  readonly head: string;
}

/** Finds the main checkout containing `cwd` (also when `cwd` is inside a linked worktree). */
export async function openRepo(cwd: string, env: Env): Promise<Repo> {
  let commonDir: string;
  try {
    commonDir = await gitOutput(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      env,
    });
  } catch (error) {
    if (error instanceof OrcError && error.code === "GIT_FAILED") {
      throw new OrcError("NOT_A_GIT_REPO", `${cwd} is not inside a git repository`, [
        error.message,
      ]);
    }
    throw error;
  }
  // The common dir is <main checkout>/.git for a normal repository.
  if (basename(commonDir) !== ".git") {
    throw new OrcError(
      "NOT_A_GIT_REPO",
      `${cwd}: bare repositories and custom git dirs are not supported (git dir: ${commonDir})`,
    );
  }
  return { root: await realpath(dirname(commonDir)), env };
}

export function workstreamBranch(name: string): string {
  assertSessionName(name);
  return `${BRANCH_PREFIX}${name}`;
}

/** Default home for worktrees: "<repo>-orc-worktrees" next to the main checkout. */
export function defaultWorktreesDir(repoRoot: string): string {
  return join(dirname(repoRoot), `${basename(repoRoot)}-orc-worktrees`);
}

/** Every worktree git knows about, the main checkout first. */
export async function listWorktrees(repo: Repo): Promise<Worktree[]> {
  const out = await gitOutput(["worktree", "list", "--porcelain"], {
    cwd: repo.root,
    env: repo.env,
  });
  const worktrees: Worktree[] = [];
  for (const block of out.split(/\n\n+/)) {
    let path: string | undefined;
    let head = "";
    let branch: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      }
    }
    if (path !== undefined) {
      worktrees.push({ path, branch, head });
    }
  }
  return worktrees;
}

export interface EnsureWorktreeOptions {
  /** Workstream name; also the worktree folder name and the branch suffix. */
  readonly name: string;
  readonly worktreesDir: string;
  /** Commit-ish a NEW branch starts from. Default: the main checkout's HEAD. */
  readonly base?: string | undefined;
}

export interface EnsureBranchWorktreeOptions {
  /** Short branch name, e.g. "orc/api". */
  readonly branch: string;
  readonly worktreesDir: string;
  /** Folder under `worktreesDir`, one path segment per entry. */
  readonly folder: readonly string[];
  readonly base?: string | undefined;
}

/**
 * Returns the workstream's worktree, creating the branch and/or worktree if needed.
 * Idempotent: an existing worktree on the right branch is reused as is.
 */
export async function ensureWorktree(
  repo: Repo,
  options: EnsureWorktreeOptions,
): Promise<{ worktree: WorkstreamWorktree; created: boolean }> {
  const { path, head, created } = await ensureBranchWorktree(repo, {
    branch: workstreamBranch(options.name),
    worktreesDir: options.worktreesDir,
    folder: [options.name],
    base: options.base,
  });
  const branch = workstreamBranch(options.name);
  return { worktree: { name: options.name, path, branch, head }, created };
}

/** The shared core of `ensureWorktree`: any branch, any folder below `worktreesDir`. */
export async function ensureBranchWorktree(
  repo: Repo,
  options: EnsureBranchWorktreeOptions,
): Promise<{ path: string; head: string; created: boolean }> {
  const { branch } = options;
  const ref = `refs/heads/${branch}`;
  const run = { cwd: repo.root, env: repo.env };

  await mkdir(options.worktreesDir, { recursive: true });
  const path = join(await realpath(options.worktreesDir), ...options.folder);
  const fromRoot = relative(repo.root, path);
  if (fromRoot === "" || !(fromRoot.startsWith("..") || isAbsolute(fromRoot))) {
    throw new OrcError(
      "WORKTREE_CONFLICT",
      `worktrees must live outside the main checkout (${repo.root}), got ${path}`,
    );
  }
  // Forget worktrees whose folders were deleted by hand, so they can be recreated.
  await git(["worktree", "prune"], run);

  const worktrees = await listWorktrees(repo);
  const atPath = worktrees.find((wt) => wt.path === path);
  if (atPath !== undefined) {
    if (atPath.branch !== ref) {
      throw new OrcError(
        "WORKTREE_CONFLICT",
        `${path} is a worktree on ${atPath.branch ?? "a detached HEAD"}, expected ${branch}`,
      );
    }
    return { path, head: atPath.head, created: false };
  }
  const elsewhere = worktrees.find((wt) => wt.branch === ref);
  if (elsewhere !== undefined) {
    throw new OrcError(
      "WORKTREE_CONFLICT",
      `branch ${branch} is already checked out in ${elsewhere.path}`,
    );
  }
  if (await exists(path)) {
    throw new OrcError(
      "WORKTREE_CONFLICT",
      `${path} already exists and is not a git worktree. Move it away and try again.`,
    );
  }

  await mkdir(dirname(path), { recursive: true });
  const branchExists =
    (await git(["rev-parse", "--verify", "--quiet", ref], { ...run, okExitCodes: [1] }))
      .exitCode === 0;
  if (branchExists) {
    await git(["worktree", "add", "--quiet", path, branch], run);
  } else {
    const base = options.base ?? "HEAD";
    await assertCommit(repo, base);
    await git(["worktree", "add", "--quiet", "-b", branch, path, base], run);
  }
  const head = await gitOutput(["rev-parse", "HEAD"], { cwd: path, env: repo.env });
  return { path, head, created: true };
}

/**
 * Removes a workstream's worktree folder; the branch (and its commits) stays.
 * Refuses if the worktree has uncommitted changes. Returns false if there was none.
 */
export async function removeWorktree(
  repo: Repo,
  options: { readonly name: string; readonly worktreesDir: string },
): Promise<boolean> {
  const ref = `refs/heads/${workstreamBranch(options.name)}`;
  const worktree = (await listWorktrees(repo)).find((wt) => wt.branch === ref);
  if (worktree === undefined) {
    return false;
  }
  await git(["worktree", "remove", worktree.path], { cwd: repo.root, env: repo.env });
  return true;
}

async function assertCommit(repo: Repo, commitish: string): Promise<void> {
  const found = await git(["rev-parse", "--verify", "--quiet", `${commitish}^{commit}`], {
    cwd: repo.root,
    env: repo.env,
    okExitCodes: [1],
  });
  if (found.exitCode !== 0) {
    throw new OrcError(
      "GIT_FAILED",
      commitish === "HEAD"
        ? `${repo.root} has no commits yet. Commit the plan first, then run orc again.`
        : `${commitish} is not a commit in ${repo.root}`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
