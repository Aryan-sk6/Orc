import { loadConfig } from "../../config/load.js";
import { OrcError } from "../../core/errors.js";
import { assertVaultUntracked } from "../../git/integration.js";
import { openRepo } from "../../git/worktrees.js";
import { describeMerge, runIntegration } from "../../integration/integrate.js";
import { readDecisions } from "../../vault/decisions.js";
import { vaultPaths } from "../../vault/layout.js";
import { parsePlan, readPlanFiles } from "../../vault/plan.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export const integrateCommand: Command = {
  name: "integrate",
  summary: "Merge finished workstreams into an integration branch and run the full checks",
  help: `Usage: orc integrate [--milestone <name>]

Merges every finished workstream branch (orc/<workstream>) into the branch
orc-integration/<milestone>, in its own worktree next to the repository, then
runs installCommand (if set) and all your check commands there. Dependencies
are merged first. No model is called.

A workstream is finished when all its tasks are ticked. Unfinished ones, and
ones that depend on them, are skipped. A merge conflict is aborted (the branch is
left as it was), written to <vault>/decisions.md, and the other workstreams still
merge: workstreams own disjoint files, so a conflict means the plan was wrong or
an agent strayed. Resolve it by hand in the integration worktree, then run this
again. Failing checks are escalated the same way. Safe to run repeatedly.

A new worktree has no node_modules: set "installCommand" in orc.config.json
(for example "npm ci") so the checks can run there.

Options:
  --milestone <name>   Branch suffix, lowercase kebab-case (default: m1)
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { milestone: { type: "string" } });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const vault = vaultPaths(loaded.vaultPath);

    const files = await readPlanFiles(vault);
    const parsed = parsePlan(files);
    if (!parsed.ok) {
      throw new OrcError(
        "PLAN_INVALID",
        files.size === 0
          ? `no plan in ${loaded.vaultPath}. Run "orc plan <idea.md>" first.`
          : "the plan in the vault is not valid:",
        files.size === 0 ? [] : parsed.issues,
      );
    }
    const repo = await openRepo(loaded.rootDir, io.env);
    await assertVaultUntracked(repo, loaded.vaultPath);

    const result = await runIntegration({
      config: loaded.config,
      vault,
      repo,
      plan: parsed.value,
      milestone: values.milestone ?? "m1",
      env: io.env,
      now: io.now,
      signal: io.signal,
      onProgress: (message) => io.stdout(`${message}\n`),
    });

    io.stdout(
      `\n${renderTable(
        [{ header: "WORKSTREAM" }, { header: "RESULT", maxWidth: 80 }],
        result.merges.map((m) => [m.workstream, describeMerge(m.status)]),
      )}\n`,
    );
    if (result.checks !== null) {
      io.stdout(
        `\n${renderTable(
          [{ header: "CHECK" }, { header: "RESULT" }],
          result.checks.map((c) => [c.name, c.status]),
        )}\n`,
      );
    }
    io.stdout(`\nBranch: ${result.branch}\nWorktree: ${result.worktreePath}\n`);
    if (result.reason !== null) {
      io.stdout(`${result.end === "stopped" ? "Stopped" : "Not finished"}: ${result.reason}\n`);
    }
    const open = (await readDecisions(vault)).filter((d) => d.status === "open");
    if (open.length > 0) {
      io.stdout(
        `Open decisions: ${open.length}. Read ${vault.decisions}, then run "orc integrate" again.\n`,
      );
    }
    return result.end === "stopped" ? 130 : result.end === "done" ? 0 : 1;
  },
};
