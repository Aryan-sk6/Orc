import { join } from "node:path";
import { OrcError } from "../core/errors.js";

/** File and folder names inside a target app's vault. Single source of truth for code and kit templates. */
export const VAULT_LAYOUT = {
  log: "LOG.md",
  sessionsDir: "sessions",
  decisions: "decisions.md",
  rules: "rules.md",
  report: "report.md",
  planDir: "plan",
  contractsDir: "contracts",
  docsDir: "docs",
  templatesDir: "templates",
} as const;

export interface VaultPaths {
  readonly root: string;
  readonly log: string;
  readonly sessionsDir: string;
  readonly decisions: string;
  readonly rules: string;
  readonly report: string;
  readonly planDir: string;
  readonly contractsDir: string;
  readonly docsDir: string;
  readonly templatesDir: string;
}

export function vaultPaths(root: string): VaultPaths {
  return {
    root,
    log: join(root, VAULT_LAYOUT.log),
    sessionsDir: join(root, VAULT_LAYOUT.sessionsDir),
    decisions: join(root, VAULT_LAYOUT.decisions),
    rules: join(root, VAULT_LAYOUT.rules),
    report: join(root, VAULT_LAYOUT.report),
    planDir: join(root, VAULT_LAYOUT.planDir),
    contractsDir: join(root, VAULT_LAYOUT.contractsDir),
    docsDir: join(root, VAULT_LAYOUT.docsDir),
    templatesDir: join(root, VAULT_LAYOUT.templatesDir),
  };
}

const SESSION_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Session names become file and branch names, so they are restricted to lowercase kebab-case. */
export function isValidSessionName(name: string): boolean {
  return SESSION_NAME.test(name);
}

export function assertSessionName(name: string): void {
  if (!isValidSessionName(name)) {
    throw new OrcError(
      "INVALID_SESSION_NAME",
      `invalid session name "${name}": use lowercase letters, digits and dashes (max 63 chars)`,
    );
  }
}

export function sessionNotePath(paths: VaultPaths, name: string): string {
  assertSessionName(name);
  return join(paths.sessionsDir, `${name}.md`);
}
