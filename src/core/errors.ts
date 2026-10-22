export type OrcErrorCode =
  | "USAGE"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_UNREADABLE"
  | "CONFIG_INVALID_JSON"
  | "CONFIG_INVALID"
  | "INVALID_SESSION_NAME"
  | "INVALID_LOG_ENTRY"
  | "VAULT_NOT_FOUND"
  | "SESSION_NOTE_INVALID"
  | "MISSING_API_KEY"
  | "FAKE_SCRIPT_INVALID"
  | "FAKE_SCRIPT_EXHAUSTED"
  | "FAKE_SCRIPT_MISMATCH"
  | "AGENT_FAILED"
  | "BUDGET_EXCEEDED"
  | "IDEA_NOT_FOUND"
  | "PLAN_EXISTS"
  | "PLAN_INVALID"
  | "SETUP_INCOMPLETE"
  | "PROMPT_NOT_FOUND"
  | "NOT_A_GIT_REPO"
  | "GIT_FAILED"
  | "WORKTREE_CONFLICT"
  | "CHECKPOINT_NOT_FOUND"
  | "VAULT_TRACKED"
  | "REWIND_BLOCKED";

/** Expected failure with a stable code. Only src/cli/ turns these into output and exit codes. */
export class OrcError extends Error {
  readonly code: OrcErrorCode;
  readonly details: readonly string[];

  constructor(code: OrcErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "OrcError";
    this.code = code;
    this.details = details;
  }
}

/** `code` of a Node.js system error (e.g. "ENOENT"), if `error` has one. */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
