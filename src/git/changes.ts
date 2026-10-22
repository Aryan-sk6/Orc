import type { WorktreeRef } from "./checkpoints.js";
import { gitOutput } from "./git.js";

/** Files changed since HEAD (tracked edits and new untracked files), sorted. For LOG "touching:". */
export async function changedFiles(worktree: WorktreeRef): Promise<string[]> {
  const run = { cwd: worktree.path, env: worktree.env };
  const [tracked, untracked] = await Promise.all([
    gitOutput(["diff", "--name-only", "HEAD"], run),
    gitOutput(["ls-files", "--others", "--exclude-standard"], run),
  ]);
  const names = new Set(
    `${tracked}\n${untracked}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  return [...names].sort();
}
