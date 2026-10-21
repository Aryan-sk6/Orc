import type { CheckCommand, OrcConfig } from "./types.js";

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

const DEFAULT_CHECKS: readonly CheckCommand[] = [
  { name: "typecheck", command: "npm run typecheck", timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
  { name: "lint", command: "npm run lint", timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
  { name: "test", command: "npm test", timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
  { name: "build", command: "npm run build", timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
];

export const DEFAULT_CONFIG: OrcConfig = {
  vaultDir: "vault",
  adapter: "claude-agent-sdk",
  planner: { model: "claude-opus-5-5" },
  driver: { model: "claude-haiku-5-5" },
  maxBudgetUsd: 20,
  retries: { maxPerTask: 2 },
  checks: DEFAULT_CHECKS,
};
