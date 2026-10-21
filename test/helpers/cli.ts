import type { CliIO } from "../../src/cli/io.js";
import { localTime } from "./tmp-dir.js";

export interface CapturedIO extends CliIO {
  readonly out: () => string;
  readonly err: () => string;
}

export interface CaptureOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Lines returned by readLine, in order; after the last one, readLine returns null (EOF). */
  readonly input?: readonly string[];
}

/** CliIO that records stdout/stderr, returns a fixed clock and replays scripted stdin lines. */
export function captureIO(
  cwd = process.cwd(),
  now: Date = localTime(),
  options: CaptureOptions = {},
): CapturedIO {
  let out = "";
  let err = "";
  const input = [...(options.input ?? [])];
  return {
    cwd,
    now: () => now,
    env: options.env ?? {},
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    readLine: async (prompt) => {
      out += prompt;
      const line = input.shift();
      if (line === undefined) {
        return null;
      }
      out += `${line}\n`;
      return line;
    },
    out: () => out,
    err: () => err,
  };
}
