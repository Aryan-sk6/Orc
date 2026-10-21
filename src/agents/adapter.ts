/**
 * The seam between orc and any coding-agent backend (Claude Agent SDK in M3, Codex later).
 * SDK-agnostic on purpose: nothing here may import an SDK. Adapters translate their
 * backend's messages, permission model and cost reporting into these shapes.
 */

/**
 * What a turn may touch. Adapters map this onto their own permission model.
 * "read-only": read and search files only. "edit": also write files and run allowed commands.
 */
export type AgentAccess = "read-only" | "edit";

/** How a turn ended. Only "success" carries usable `text`. */
export type AgentOutcome = "success" | "max_turns" | "max_budget" | "refused" | "error";

export const AGENT_OUTCOMES: readonly AgentOutcome[] = [
  "success",
  "max_turns",
  "max_budget",
  "refused",
  "error",
];

/** Progress emitted while a turn runs, for display only. Decisions are made on the result. */
export type AgentEvent =
  | { readonly type: "session"; readonly sessionId: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly name: string };

export interface AgentTurnRequest {
  readonly prompt: string;
  /** Working directory of the session (a worktree for coding sessions). */
  readonly cwd: string;
  readonly model: string;
  /** Instructions appended to the adapter's default system prompt, sent on every turn. */
  readonly systemPrompt?: string | undefined;
  /** Continue this session with full prior context instead of starting a new one. */
  readonly resumeSessionId?: string | undefined;
  readonly access: AgentAccess;
  /** USD cap for this turn (an estimate). Reaching it ends the turn with outcome "max_budget". */
  readonly maxBudgetUsd?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onEvent?: ((event: AgentEvent) => void) | undefined;
}

export interface AgentTurnResult {
  /** Pass as `resumeSessionId` to continue this conversation. */
  readonly sessionId: string;
  readonly outcome: AgentOutcome;
  /** The turn's final text. "" unless `outcome` is "success". */
  readonly text: string;
  /**
   * Estimated USD spent by this turn alone. Backends that report cumulative totals
   * (the Agent SDK on resume) must convert them to a per-turn delta.
   */
  readonly costUsd: number;
  readonly durationMs: number;
  /** Error messages from the backend when `outcome` is not "success". */
  readonly errors: readonly string[];
}

export interface AgentAdapter {
  /** Short backend name for logs, e.g. "fake" or "claude-agent-sdk". */
  readonly name: string;
  /**
   * Runs one turn to completion. Agent-level failures (budget, refusal, backend errors)
   * resolve with a non-success `outcome`; only misuse or a broken backend rejects.
   */
  runTurn(request: AgentTurnRequest): Promise<AgentTurnResult>;
  /** Releases processes or connections. Safe to call more than once. */
  close(): Promise<void>;
}
