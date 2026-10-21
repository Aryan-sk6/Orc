import type { CliIO } from "../../src/cli/io.js";
import { localTime } from "./tmp-dir.js";

export interface CapturedIO extends CliIO {
  readonly out: () => string;
  readonly err: () => string;
}

/** CliIO that records stdout/stderr and returns a fixed clock. */
export function captureIO(cwd = process.cwd(), now: Date = localTime()): CapturedIO {
  let out = "";
  let err = "";
  return {
    cwd,
    now: () => now,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    out: () => out,
    err: () => err,
  };
}
