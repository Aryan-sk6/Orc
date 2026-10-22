import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { OrcError } from "../core/errors.js";
import type { WorktreeRef } from "./checkpoints.js";
import { git, gitOutput } from "./git.js";
import { ensureBranchWorktree, type Repo } from "./worktrees.js";

/*
 * Integration: one branch per milestone, orc-integration/<milestone>, in its own worktree below
 * <repo>-orc-worktrees/_integration/. The underscore cannot appear in a workstream name, so the
 * folder never clashes with a workstream worktree. Branches are never deleted by orc.
 */

export const INTEGRATION_BRANCH_PREFIX = "orc-integration/";
const INTEGRATION_FOLDER = "_integration";
const MILESTONE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface IntegrationWorktree {
  readonly milestone: string;
  readonly path: string;
  /** Short branch name, e.g. "orc-integration/m1". */
  readonly branch: string;
  readonly head: string;
}

export function integrationBranch(milestone: string): string {
  if (!MILESTONE.test(milestone)) {
    throw new OrcError(
      "USAGE",
      `invalid milestone "${milestone}": use lowercase letters, digits and dashes (max 63 chars)`,
    );
  }
  return `${INTEGRATION_BRANCH_PREFIX}${milestone}`;
}

/** Creates the milestone's branch (from the main checkout's HEAD) and worktree, or reuses them. */
export async function ensureIntegrationWorktree(
  repo: Repo,
  options: {
    readonly milestone: string;
    readonly worktreesDir: string;
    readonly base?: string | undefined;
  },
): Promise<{ worktree: IntegrationWorktree; created: boolean }> {
  const branch = integrationBranch(options.milestone);
  const { path, head, created } = await ensureBranchWorktree(repo, {
    branch,
    worktreesDir: options.worktreesDir,
    folder: [INTEGRATION_FOLDER, options.milestone],
    base: options.base,
  });
  return { worktree: { milestone: options.milestone, path, branch, head }, created };
}

export type MergeResult =
  | { readonly kind: "merged"; readonly commit: string }
  | { readonly kind: "up-to-date" }
  | { readonly kind: "conflict"; readonly files: readonly string[] };

/**
 * Merges `branch` into the worktree's current branch with a merge commit. A conflict is aborted,
 * leaving the worktree exactly as it was, and reported with the conflicting files. Hooks are
 * skipped, like every other commit orc makes.
 */
export async function mergeBranch(
  worktree: WorktreeRef,
  branch: string,
  message: string,
): Promise<MergeResult> {
  const run = { cwd: worktree.path, env: worktree.env };
  const contained = await git(["merge-base", "--is-ancestor", branch, "HEAD"], {
    ...run,
    okExitCodes: [1],
  });
  if (contained.exitCode === 0) {
    return { kind: "up-to-date" };
  }

  const merged = await git(["merge", "--no-ff", "--no-verify", "--quiet", "-m", message, branch], {
    ...run,
    okExitCodes: [1],
  });
  if (merged.exitCode === 0) {
    return { kind: "merged", commit: await gitOutput(["rev-parse", "HEAD"], run) };
  }

  const inMerge =
    (await git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { ...run, okExitCodes: [1] }))
      .exitCode === 0;
  if (!inMerge) {
    throw new OrcError(
      "GIT_FAILED",
      `merging ${branch} failed without a conflict. Look at ${worktree.path} (uncommitted changes there?).`,
    );
  }
  const files = (await gitOutput(["diff", "--name-only", "--diff-filter=U"], run))
    .split("\n")
    .filter((file) => file !== "");
  await git(["merge", "--abort"], run);
  return { kind: "conflict", files };
}

/** `dir` relative to the main checkout ("" for the root itself); null if missing or outside the repo. */
async function repoRelative(repo: Repo, dir: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return null;
  }
  const rel = relative(repo.root, real);
  return rel.startsWith("..") || isAbsolute(rel) ? null : rel;
}

/** Files below `dir` that git tracks in the main checkout. Empty if `dir` is outside the repo or missing. */
export async function trackedFilesUnder(repo: Repo, dir: string): Promise<string[]> {
  const rel = await repoRelative(repo, dir);
  if (rel === null) {
    return [];
  }
  const out = await gitOutput(["ls-files", "--", rel === "" ? "." : rel], {
    cwd: repo.root,
    env: repo.env,
  });
  return out.split("\n").filter((file) => file !== "");
}

/**
 * orc keeps the vault out of git: worktrees get no copy of it and merges never touch it. A
 * tracked vault would be checked out stale into every worktree, so refuse to start instead.
 */
export async function assertVaultUntracked(repo: Repo, vaultDir: string): Promise<void> {
  const tracked = await trackedFilesUnder(repo, vaultDir);
  if (tracked.length === 0) {
    return;
  }
  const rel = (await repoRelative(repo, vaultDir)) || ".";
  throw new OrcError(
    "VAULT_TRACKED",
    `${tracked.length} file${tracked.length === 1 ? "" : "s"} of the vault (${rel}) ${tracked.length === 1 ? "is" : "are"} tracked by git, but orc keeps the vault out of git. Untrack it:`,
    [
      `git rm -r --cached ${rel}`,
      `echo "${rel}/" >> .gitignore`,
      "git commit -m 'chore: stop tracking the orc vault'",
    ],
  );
}
