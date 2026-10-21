import { loadConfig } from "../../config/load.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";

export const configCommand: Command = {
  name: "config",
  summary: "Print the resolved config (orc.config.json merged with defaults)",
  help: `Usage: orc config [-c <path>]

Prints the resolved config as JSON, with where it was read from (sourcePath),
the directory relative paths resolve against (rootDir) and the vault path.
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, {});
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    io.stdout(`${JSON.stringify(loaded, null, 2)}\n`);
    return 0;
  },
};
