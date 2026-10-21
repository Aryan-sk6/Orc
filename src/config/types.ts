/** Which AgentAdapter drives coding sessions. "fake" replays scripted outputs (tests, dev runs). */
export type AdapterKind = "claude-agent-sdk" | "fake";

export const ADAPTER_KINDS: readonly AdapterKind[] = ["claude-agent-sdk", "fake"];

export interface ModelConfig {
  readonly model: string;
}

export interface RetryConfig {
  /** Fix attempts per task after failed checks before escalating to decisions.md. */
  readonly maxPerTask: number;
}

/** One deterministic check run in the target app after every session turn, in array order. */
export interface CheckCommand {
  readonly name: string;
  readonly command: string;
  readonly timeoutMs: number;
}

/** Fully resolved config: every field present. */
export interface OrcConfig {
  /** Target app vault, relative to the config file's directory. */
  readonly vaultDir: string;
  readonly adapter: AdapterKind;
  readonly planner: ModelConfig;
  readonly driver: ModelConfig;
  /**
   * Run-wide spend cap in USD, based on the Agent SDK's client-side cost estimate (`total_cost_usd`).
   * Each SDK call gets the remaining budget as its `maxBudgetUsd`. Reaching it pauses sessions.
   */
  readonly maxBudgetUsd: number;
  readonly retries: RetryConfig;
  readonly checks: readonly CheckCommand[];
}

export interface ModelConfigInput {
  readonly model?: string | undefined;
}

export interface RetryConfigInput {
  readonly maxPerTask?: number | undefined;
}

export interface CheckCommandInput {
  readonly name: string;
  readonly command: string;
  readonly timeoutMs?: number | undefined;
}

/** Validated contents of orc.config.json. Omitted fields take defaults; `checks` replaces wholesale. */
export interface OrcConfigInput {
  readonly vaultDir?: string | undefined;
  readonly adapter?: AdapterKind | undefined;
  readonly planner?: ModelConfigInput | undefined;
  readonly driver?: ModelConfigInput | undefined;
  readonly maxBudgetUsd?: number | undefined;
  readonly retries?: RetryConfigInput | undefined;
  readonly checks?: readonly CheckCommandInput[] | undefined;
}
