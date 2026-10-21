export type OrcErrorCode = "USAGE";

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
