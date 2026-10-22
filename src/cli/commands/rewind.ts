import { loadConfig } from "../../config/load.js";
import { OrcError } from "../../core/errors.js";
import { listCheckpoints } from "../../git/checkpoints.js";
import { openRepo } from "../../git/worktrees.js";
import { rewindWorkstream } from "../../rewind/rewind.js";
import { vaultPaths } from "../../vault/layout.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export const rewindCommand: Command = {
  name: "rewind",
  summary: "Put a workstream back to the checkpoint taken before a task",
  help: `Usage:
  orc rewind <checkpoint> [--force]
  orc rewind --list [<workstream>]

Before each task orc tags a checkpoint, "<workstream>/<task>" (for example
"api/T3", or "api/T3.2" for a second attempt). Rewinding to it:

  - resets the workstream's worktree to that commit. The work you discard is
    committed first and kept under a tag orc-backup/<workstream>/<n>, so a
    rewind can be undone with: git -C <worktree> reset --hard <that tag>
  - unticks that task and every later one in the workstream's plan note
  - resets the session note; the next "orc run" starts the task again in a
    fresh agent conversation (the old one remembers the discarded work)

Nothing is deleted. Integration branches that already merged the discarded work
keep it; reset or recreate them by hand. Do not rewind while "orc run" is running
for that workstream.

Options:
  --list    List checkpoints (all, or one workstream's) instead of rewinding
  --force   Rewind although the session note says it is running (orc was killed)
`,
  run: async (argv, io) => {
    const { values, positionals } = parseCommandArgs(argv, {
      list: { type: "boolean" },
      force: { type: "boolean" },
    });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const repo = await openRepo(loaded.rootDir, io.env);

    if (values.list === true) {
      if (positionals.length > 1) {
        throw new OrcError("USAGE", "--list takes at most one workstream name");
      }
      const checkpoints = await listCheckpoints(repo, positionals[0]);
      if (checkpoints.length === 0) {
        io.stdout("No checkpoints yet. orc run creates one before each task.\n");
        return 0;
      }
      io.stdout(
        `${renderTable(
          [{ header: "CHECKPOINT" }, { header: "COMMIT" }],
          checkpoints.map((cp) => [cp.id, cp.commit.slice(0, 7)]),
        )}\n`,
      );
      return 0;
    }

    const id = positionals[0];
    if (id === undefined || positionals.length > 1) {
      throw new OrcError(
        "USAGE",
        'give one checkpoint, e.g. "orc rewind api/T3" ("orc rewind --list" shows them)',
      );
    }
    const result = await rewindWorkstream({
      vault: vaultPaths(loaded.vaultPath),
      repo,
      checkpointId: id,
      force: values.force,
      env: io.env,
      now: io.now,
    });

    io.stdout(
      `Rewound ${result.workstream} to ${result.checkpoint}.\n` +
        `Worktree: ${result.worktreePath}\n` +
        `Discarded work is kept at tag ${result.backupTag}.\n` +
        `Unticked: ${result.undoneTasks.length === 0 ? "nothing" : result.undoneTasks.join(", ")} (${result.tasksDone} tasks still done)\n`,
    );
    if (result.dependentTasks.length > 0) {
      io.stdout(
        `Warning: these finished tasks were built on a task you just undid: ${result.dependentTasks.join(", ")}\n`,
      );
    }
    if (result.integrationBranches.length > 0) {
      io.stdout(
        `Warning: ${result.integrationBranches.join(", ")} still contains the discarded work.\n`,
      );
    }
    io.stdout('Run "orc run" to start the task again.\n');
    return 0;
  },
};
