import { type ParseArgsConfig, parseArgs } from "node:util";
import { errorCode, errorMessage, OrcError } from "../core/errors.js";

type OptionSpec = NonNullable<ParseArgsConfig["options"]>;

/** Options every command accepts. */
export const GLOBAL_OPTIONS = {
  config: { type: "string", short: "c" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const satisfies OptionSpec;

export const GLOBAL_OPTIONS_HELP = `Global options:
  -c, --config <path>    Config file (default: ./orc.config.json)
  -h, --help             Show help (for a command: orc <command> --help)
  -v, --version          Show the orc version
`;

export interface CommandLine {
  readonly command: string | undefined;
  /** argv without the command name, for the command's own strict parse. */
  readonly rest: readonly string[];
  readonly help: boolean;
  readonly version: boolean;
}

/**
 * Finds the command name: the first positional argument. Command-specific options
 * are unknown at this point, so they must come after the command name.
 */
export function splitCommandLine(argv: readonly string[]): CommandLine {
  const { values, tokens } = parseArgs({
    args: [...argv],
    options: GLOBAL_OPTIONS,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  const first = tokens.find((token) => token.kind === "positional");
  const rest = first === undefined ? [...argv] : argv.filter((_, index) => index !== first.index);
  return {
    command: first?.kind === "positional" ? first.value : undefined,
    rest,
    help: values.help === true,
    version: values.version === true,
  };
}

/** Strict parse of a command's argv with its own options plus the global ones. */
export function parseCommandArgs<const T extends OptionSpec>(argv: readonly string[], options: T) {
  try {
    return parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    // parseArgs throws TypeErrors with ERR_PARSE_ARGS_* codes for unknown or malformed options.
    if (errorCode(error)?.startsWith("ERR_PARSE_ARGS") === true) {
      throw new OrcError("USAGE", errorMessage(error));
    }
    throw error;
  }
}

/** Parses a non-negative integer option value, or throws a USAGE error naming the option. */
export function parseCountOption(value: string, option: string): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count)) {
    throw new OrcError("USAGE", `--${option} must be a non-negative integer, got "${value}"`);
  }
  return count;
}
