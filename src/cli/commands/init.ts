import { loadConfig } from "../../config/load.js";
import { checkKit, installKit } from "../../kit/install.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export const initCommand: Command = {
  name: "init",
  summary: "Copy the orc kit (skills, driver subagent, vault) into this folder",
  help: `Usage: orc init [--force]
       orc init --check

Installs the kit in the current project (the folder with orc.config.json, or here):
  .claude/skills/orc-plan|orc-run|orc-summarize/SKILL.md   the /orc-plan, /orc-run
                            and /orc-summarize slash commands (the planner and summary
                            prompts are embedded from kit/prompts/)
  .claude/agents/orc-driver.md   read-only driver subagent on a small model
  AGENTS.md, CLAUDE.md      an "orc orchestrator" block, added or replaced between
                            <!-- orc:begin --> and <!-- orc:end -->; the rest is untouched
  <vault>/                  LOG.md, decisions.md, rules.md, docs/, plan/, contracts/,
                            sessions/ and templates/ (created when missing)
  orc.config.json           all defaults (created when missing)
  .gitignore                gets "<vault>/" (orc run refuses a tracked vault)

Safe to run again. Skills and the subagent that differ from the shipped version are
kept unless you pass --force. Run it BEFORE you start Claude Code in the folder: a new
.claude/agents/ directory is only picked up at session start.

Options:
  --force   Overwrite skills and the subagent file with the shipped version
  --check   Write nothing: report which installed kit files are outdated or missing
            compared with this version of orc (for example after a prompt changed).
            Exits 1 if any are. Fix with "orc init --force".
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, {
      force: { type: "boolean" },
      check: { type: "boolean" },
    });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    if (values.check === true) {
      const status = await checkKit({ rootDir: loaded.rootDir, vaultDir: loaded.config.vaultDir });
      io.stdout(
        `${renderTable(
          [{ header: "STATUS" }, { header: "PATH" }],
          status.map((file) => [file.status, file.path]),
        )}\n`,
      );
      const stale = status.some((file) => file.status !== "current");
      io.stdout(
        stale
          ? 'The kit is out of date. Run "orc init --force" to refresh skills and the subagent.\n'
          : "The kit is up to date.\n",
      );
      return stale ? 1 : 0;
    }
    const report = await installKit({
      rootDir: loaded.rootDir,
      vaultDir: loaded.config.vaultDir,
      force: values.force === true,
    });
    io.stdout(
      `orc kit installed in ${loaded.rootDir}\n${renderTable(
        [{ header: "ACTION" }, { header: "PATH" }],
        report.map((file) => [file.action, file.path]),
      )}\n`,
    );
    const kept = report.filter((file) => file.action === "kept");
    if (kept.length > 0) {
      io.stdout(
        `${kept.length} file(s) differ from the shipped version and were kept; use --force to replace them.\n`,
      );
    }
    io.stdout(
      "\nNext: open Claude Code here and run /orc-plan <idea.md> (or: orc plan <idea.md>).\n",
    );
    return 0;
  },
};
