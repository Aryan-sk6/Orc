import type { Command } from "./command.js";
import { checkSetupCommand } from "./commands/check-setup.js";
import { configCommand } from "./commands/config.js";
import { integrateCommand } from "./commands/integrate.js";
import { logCommand } from "./commands/log.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";

/** Every `orc` subcommand, in the order `orc --help` lists them. */
export const COMMANDS: readonly Command[] = [
  planCommand,
  checkSetupCommand,
  runCommand,
  integrateCommand,
  statusCommand,
  logCommand,
  configCommand,
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}
