import type { CliIO } from "./io.js";

/** One `orc <name>` subcommand. Each lives in its own file under src/cli/commands/. */
export interface Command {
  readonly name: string;
  /** One line for `orc --help`. */
  readonly summary: string;
  /** Full text for `orc <name> --help`. */
  readonly help: string;
  /** `argv` excludes the command name. Returns the exit code. */
  readonly run: (argv: readonly string[], io: CliIO) => Promise<number>;
}
