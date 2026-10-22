import { execFile } from "node:child_process";
import { errorCode, OrcError } from "../core/errors.js";

/*
 * Thin wrapper over the git CLI. Arguments go straight to execFile (no shell), so names
 * and messages can't be interpreted as shell syntax.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export interface GitOptions {
  readonly cwd: string;
  readonly env: Env;
  /** Exit codes that mean "answered", not "failed" (e.g. 1 for `git diff --quiet`). */
  readonly okExitCodes?: readonly number[];
}

export interface GitResult {
  readonly stdout: string;
  readonly exitCode: number;
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs `git <args>`. Throws GIT_FAILED with git's own message on any other exit code. */
export function git(args: readonly string[], options: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        // Never block on a credential or editor prompt: orc runs unattended.
        env: { ...options.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, exitCode: 0 });
          return;
        }
        if (errorCode(error) === "ENOENT") {
          reject(new OrcError("GIT_FAILED", "git is not installed or not on PATH"));
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : -1;
        if (options.okExitCodes?.includes(exitCode) === true) {
          resolve({ stdout, exitCode });
          return;
        }
        const lines = stderr
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
        reject(
          new OrcError(
            "GIT_FAILED",
            `git ${args.join(" ")} failed: ${lines[0] ?? `exit code ${exitCode}`}`,
            lines.slice(1),
          ),
        );
      },
    );
  });
}

/** stdout of `git <args>` without the trailing newline. */
export async function gitOutput(args: readonly string[], options: GitOptions): Promise<string> {
  return (await git(args, options)).stdout.replace(/\n$/, "");
}
