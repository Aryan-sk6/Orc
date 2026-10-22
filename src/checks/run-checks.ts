import { spawn } from "node:child_process";
import type { CheckCommand } from "../config/types.js";
import { errorMessage } from "../core/errors.js";

export type CheckOutcome = "pass" | "fail";

export interface CheckResult {
  readonly name: string;
  readonly command: string;
  readonly status: CheckOutcome;
  /** null when the process was killed by a signal or never started. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** The run was cut short by the caller's abort signal; the result says nothing about the code. */
  readonly aborted: boolean;
  readonly durationMs: number;
  /** The last `maxOutputChars` of combined stdout and stderr. */
  readonly output: string;
}

export interface RunCheckOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal | undefined;
  /** Tail kept per check. Default 6000: enough for a compiler's first errors. */
  readonly maxOutputChars?: number | undefined;
  /** Injected so tests need no real clock. */
  readonly now: () => Date;
}

const DEFAULT_MAX_OUTPUT_CHARS = 6000;

/**
 * Runs one check command in a shell inside `cwd` and resolves when its output streams close.
 * The timeout is a deadline, not a poll: the process group is killed when it passes.
 * Never rejects: a command that cannot start is a failed check with the reason as its output.
 */
export function runCheck(check: CheckCommand, options: RunCheckOptions): Promise<CheckResult> {
  const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const startedAt = options.now().getTime();
  const posix = process.platform !== "win32";

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (exitCode: number | null, extra = ""): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const text = tail(output + extra, maxChars);
      resolve({
        name: check.name,
        command: check.command,
        status: exitCode === 0 && !timedOut && !aborted ? "pass" : "fail",
        exitCode,
        timedOut,
        aborted,
        durationMs: options.now().getTime() - startedAt,
        output: text,
      });
    };

    const child = spawn(check.command, {
      shell: true,
      cwd: options.cwd,
      env: definedEnv(options.env),
      // Own process group, so a timeout can also stop the grandchildren the shell started.
      detached: posix,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const kill = (): void => {
      try {
        if (posix && child.pid !== undefined) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Already gone.
      }
    };
    const onAbort = (): void => {
      aborted = true;
      kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, check.timeoutMs);

    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      // Keep memory bounded on noisy commands.
      if (output.length > maxChars * 4) {
        output = output.slice(-maxChars * 2);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) =>
      finish(null, `\n[orc] could not run the command: ${errorMessage(error)}`),
    );
    // "close" fires after the output streams end, so no trailing output is lost.
    child.on("close", (code) => {
      const note = timedOut ? `\n[orc] timed out after ${check.timeoutMs} ms` : "";
      finish(code, note);
    });

    if (options.signal?.aborted === true) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Runs every check in order. All of them run even after a failure, so one fix prompt can cover all. */
export async function runChecks(
  checks: readonly CheckCommand[],
  options: RunCheckOptions,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await runCheck(check, options);
    results.push(result);
    if (result.aborted) {
      break;
    }
  }
  return results;
}

export function failedChecks(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((result) => result.status === "fail");
}

function tail(text: string, maxChars: number): string {
  const trimmed = text.trimEnd();
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`;
}

function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
