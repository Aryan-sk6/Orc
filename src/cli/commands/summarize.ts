import { createAdapter } from "../../agents/create.js";
import { loadConfig } from "../../config/load.js";
import { loadSummaryPrompt } from "../../summarize/prompts.js";
import { runSummary } from "../../summarize/summarize.js";
import { vaultPaths } from "../../vault/layout.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { formatUsd } from "./status.js";

export const summarizeCommand: Command = {
  name: "summarize",
  summary: "Write <vault>/report.md from the session notes, decisions and log",
  help: `Usage: orc summarize [--facts-only]

Reads every session note, decisions.md and the end of LOG.md, and writes
<vault>/report.md: a short narrative (what was built, what went wrong, decisions
waiting for you, next steps) followed by tables of sessions, decisions and spend.

The tables are built by orc. The narrative is one call on the driver model with
the shared prompt kit/prompts/summary.md. That call has its own fixed cap
(summaryBudgetUsd, default $0.25, repair turns included) that is separate from the
run cap (maxBudgetUsd): it is never drawn from it. The spend is added to the
"summarize" session, so "orc status" shows it. If the model cannot be used the
report is written without the narrative.

Run it by hand. Anything automated (scripts, hooks, the M7 skills) should pass
--facts-only, which makes no model call and records no spend.

Options:
  --facts-only   Write the tables only: no model call, no API key needed
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { "facts-only": { type: "boolean" } });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const vault = vaultPaths(loaded.vaultPath);
    const factsOnly = values["facts-only"] === true;

    const systemPrompt = factsOnly ? "" : await loadSummaryPrompt();
    const adapter = factsOnly ? null : await createAdapter(loaded, io.env);
    try {
      const result = await runSummary({
        adapter,
        config: loaded.config,
        vault,
        rootDir: loaded.rootDir,
        systemPrompt,
        now: io.now,
        signal: io.signal,
      });
      io.stdout(`Wrote ${result.reportPath}\n`);
      if (result.narrative) {
        io.stdout(`Narrative: written (${formatUsd(result.costUsd)}, Agent SDK estimate)\n`);
      } else {
        io.stdout(`Narrative: none (${result.reason})\n`);
      }
      return 0;
    } finally {
      await adapter?.close();
    }
  },
};
