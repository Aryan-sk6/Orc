import { describe, expect, it } from "vitest";
import { type CliIO, main } from "./main.js";

interface CapturedIO extends CliIO {
  readonly out: () => string;
  readonly err: () => string;
}

function captureIO(cwd = process.cwd()): CapturedIO {
  let out = "";
  let err = "";
  return {
    cwd,
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

describe("main", () => {
  it("prints help and exits 0 with no arguments", async () => {
    const io = captureIO();
    expect(await main([], io)).toBe(0);
    expect(io.out()).toContain("Usage:");
    expect(io.err()).toBe("");
  });

  it("prints help for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const io = captureIO();
      expect(await main([flag], io)).toBe(0);
      expect(io.out()).toContain("Usage:");
    }
  });

  it("prints the package.json version for --version", async () => {
    const io = captureIO();
    expect(await main(["--version"], io)).toBe(0);
    expect(io.out()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exits 2 on an unknown command", async () => {
    const io = captureIO();
    expect(await main(["frobnicate"], io)).toBe(2);
    expect(io.err()).toContain('unknown command "frobnicate"');
  });

  it("exits 2 on an unknown option", async () => {
    const io = captureIO();
    expect(await main(["--nope"], io)).toBe(2);
    expect(io.err()).toContain("--nope");
  });
});
