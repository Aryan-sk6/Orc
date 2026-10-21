import { readFile } from "node:fs/promises";
import { OrcError } from "../core/errors.js";
import { GLOBAL_OPTIONS_HELP, splitCommandLine } from "./args.js";
import type { CliIO } from "./io.js";
import { COMMANDS, findCommand } from "./registry.js";

export type { CliIO } from "./io.js";

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
  const line = splitCommandLine(argv);

  if (line.version) {
    io.stdout(`${await readVersion()}\n`);
    return 0;
  }
  if (line.command === undefined) {
    io.stdout(globalHelp());
    return 0;
  }

  const command = findCommand(line.command);
  if (command === undefined) {
    throw new OrcError("USAGE", `unknown command "${line.command}". Run "orc --help".`);
  }
  if (line.help) {
    io.stdout(command.help);
    return 0;
  }
  return command.run(line.rest, io);
}

function globalHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const commands = COMMANDS.map(
    (command) => `  ${command.name.padEnd(width)}    ${command.summary}`,
  ).join("\n");
  return `orc: orchestrate AI coding sessions to build an app from one plan

Usage:
  orc <command> [options]

Commands:
${commands}

${GLOBAL_OPTIONS_HELP}`;
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
