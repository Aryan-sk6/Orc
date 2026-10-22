import { API_KEY_VAR, createAdapter } from "../../agents/create.js";
import { loadConfig } from "../../config/load.js";
import { OrcError } from "../../core/errors.js";
import { loadDriverPrompt } from "../../driver/prompts.js";
import { runDriver } from "../../driver/run.js";
import { assertVaultUntracked } from "../../git/integration.js";
import { openRepo } from "../../git/worktrees.js";
import { checkSetup } from "../../planner/check-setup.js";
import { readDecisions } from "../../vault/decisions.js";
import { vaultPaths } from "../../vault/layout.js";
import { parsePlan, readPlanFiles } from "../../vault/plan.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";
import { formatUsd } from "./status.js";

export const runCommand: Command = {
  name: "run",
  summary: "Start one coding session per workstream and drive them until done or paused",
  help: `Usage: orc run [--workstream <name>]...

Creates a git worktree and branch (orc/<workstream>) per workstream, next to the
repository in <repo>-orc-worktrees/, and starts one coding session in each.
Sessions run in parallel. Before each task orc tags a checkpoint (orc-cp/...).
After every turn it runs your check commands; if they pass, the next task is sent
without any model call. If they fail, a small driver model writes a short fix
prompt, or escalates. At most retries.maxPerTask fix prompts are sent per task.

A session pauses (the others keep going) when it hits the retry cap, needs an
answer from you, or the run cap (maxBudgetUsd) is reached. The reason is written
to <vault>/decisions.md. Fix the cause and run "orc run" again: finished tasks are
skipped and the agent conversation is resumed.

Ctrl-C stops the sessions cleanly. Spend is the Agent SDK's estimate, not billing data.

Requires: a plan (orc plan), a passing "orc check-setup", a git repository with at
least one commit, and git user.name/user.email.

Options:
  --workstream <name>   Run only this workstream (repeatable)
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { workstream: { type: "string", multiple: true } });
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

    const setup = await checkSetup({ rootDir: loaded.rootDir, vault, env: io.env });
    const needsKey = loaded.config.adapter !== "fake";
    const blockers = [
      ...setup.planProblems,
      ...setup.envVars
        .filter((v) => v.required && v.foundIn === null && (needsKey || v.name !== API_KEY_VAR))
        .map((v) => `env var ${v.name} is not set`),
      ...setup.docs.filter((d) => d.status !== "ok").map((d) => `docs/${d.file} is ${d.status}`),
    ];
    if (blockers.length > 0) {
      throw new OrcError(
        "SETUP_INCOMPLETE",
        'setup is incomplete (run "orc check-setup" for details):',
        blockers,
      );
    }

    const repo = await openRepo(loaded.rootDir, io.env);
    await assertVaultUntracked(repo, loaded.vaultPath);
    const driverSystemPrompt = await loadDriverPrompt();
    const adapter = await createAdapter(loaded, io.env);
    try {
      const result = await runDriver({
        adapter,
        config: loaded.config,
        vault,
        repo,
        plan: parsed.value,
        driverSystemPrompt,
        env: io.env,
        now: io.now,
        only: values.workstream,
        signal: io.signal,
        onProgress: (message) => io.stdout(`${message}\n`),
      });

      io.stdout(
        `\n${renderTable(
          [
            { header: "SESSION" },
            { header: "END" },
            { header: "TASKS", align: "right" },
            { header: "COST", align: "right" },
            { header: "REASON", maxWidth: 70 },
          ],
          result.sessions.map((s) => [
            s.session,
            s.end,
            `${s.tasksDone}/${s.tasksTotal}`,
            formatUsd(s.costUsd),
            s.reason ?? "-",
          ]),
        )}\n\nSpend: ${formatUsd(result.spentUsd)} of ${formatUsd(result.capUsd)} run cap ` +
          "(Agent SDK estimate, not billing data)\n",
      );
      const open = (await readDecisions(vault)).filter((d) => d.status === "open");
      if (open.length > 0) {
        io.stdout(
          `Open decisions: ${open.length}. Read ${vault.decisions}, then run "orc run" again.\n`,
        );
      }
      if (result.sessions.some((s) => s.end === "stopped")) {
        return 130;
      }
      return result.sessions.every((s) => s.end === "done") ? 0 : 1;
    } finally {
      await adapter.close();
    }
  },
};
