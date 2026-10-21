import { loadConfig } from "../../config/load.js";
import { OrcError } from "../../core/errors.js";
import { vaultPaths } from "../../vault/layout.js";
import { appendLog, formatLogLine, readLogTail } from "../../vault/log.js";
import { parseCommandArgs, parseCountOption } from "../args.js";
import type { Command } from "../command.js";

export const logCommand: Command = {
  name: "log",
  summary: "Append a line to the vault LOG, or print its last lines",
  help: `Usage:
  orc log <what was done> -s <session> [-t <file,file>]...
  orc log --tail <n>

Options:
  -s, --session <name>    Session writing the line (lowercase kebab-case)
  -t, --touching <files>  Files touched; comma-separated, repeatable
  -n, --tail <n>          Print the last n LOG entries instead of appending

Writes "[YYYY-MM-DD HH:mm][session] did X | touching: files" to <vault>/LOG.md.
`,
  run: async (argv, io) => {
    const { values, positionals } = parseCommandArgs(argv, {
      session: { type: "string", short: "s" },
      touching: { type: "string", short: "t", multiple: true },
      tail: { type: "string", short: "n" },
    });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const paths = vaultPaths(loaded.vaultPath);

    if (values.tail !== undefined) {
      if (positionals.length > 0 || values.session !== undefined) {
        throw new OrcError("USAGE", "--tail cannot be combined with a message or --session");
      }
      const entries = await readLogTail(paths, parseCountOption(values.tail, "tail"));
      for (const entry of entries) {
        io.stdout(`${formatLogLine(entry)}\n`);
      }
      return 0;
    }

    if (values.session === undefined) {
      throw new OrcError("USAGE", '--session is required. Run "orc log --help".');
    }
    const entry = await appendLog(paths, {
      session: values.session,
      did: positionals.join(" "),
      touching: (values.touching ?? []).flatMap((files) => files.split(",")),
      now: io.now(),
    });
    io.stdout(`${formatLogLine(entry)}\n`);
    return 0;
  },
};
