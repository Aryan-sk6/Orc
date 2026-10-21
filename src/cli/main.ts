import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { errorCode, errorMessage, OrcError } from "../core/errors.js";

/** Everything the CLI touches in the outside world, injected so tests can capture it. */
export interface CliIO {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const HELP = `orc: orchestrate AI coding sessions to build an app from one plan

Usage:
  orc <command> [options]

Commands:
  (none yet; see vault/Context/Roadmap.md)

Options:
  -h, --help       Show this help
  -v, --version    Show the orc version
`;

/** Runs the CLI and returns the process exit code. Never calls process.exit. */
export async function main(argv: readonly string[], io: CliIO): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (error instanceof OrcError) {
      io.stderr(`orc: ${error.message}\n`);
      for (const detail of error.details) {
        io.stderr(`  - ${detail}\n`);
      }
      return error.code === "USAGE" ? 2 : 1;
    }
    throw error;
  }
}

async function run(argv: readonly string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseCliArgs(argv);

  if (values.version) {
    io.stdout(`${await readVersion()}\n`);
    return 0;
  }

  const [command] = positionals;
  if (values.help || command === undefined) {
    io.stdout(HELP);
    return 0;
  }

  throw new OrcError("USAGE", `unknown command "${command}". Run "orc --help".`);
}

function parseCliArgs(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    // parseArgs throws TypeErrors with ERR_PARSE_ARGS_* codes for unknown or malformed options.
    if (errorCode(error)?.startsWith("ERR_PARSE_ARGS") === true) {
      throw new OrcError("USAGE", errorMessage(error));
    }
    throw error;
  }
}

async function readVersion(): Promise<string> {
  // Same relative path from src/cli/ (tests) and dist/cli/ (installed bin).
  const text = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  const pkg: unknown = JSON.parse(text);
  if (typeof pkg === "object" && pkg !== null && "version" in pkg) {
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  }
  return "unknown";
}
