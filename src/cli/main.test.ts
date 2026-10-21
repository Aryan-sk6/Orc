import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults.js";
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

describe("orc config", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orc-cli-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("prints the resolved defaults as JSON when no config file exists", async () => {
    const io = captureIO(tmp);
    expect(await main(["config"], io)).toBe(0);
    const printed: unknown = JSON.parse(io.out());
    expect(printed).toEqual({
      config: DEFAULT_CONFIG,
      sourcePath: null,
      rootDir: tmp,
      vaultPath: join(tmp, "vault"),
    });
  });

  it("honours --config / -c", async () => {
    await writeFile(join(tmp, "alt.json"), JSON.stringify({ adapter: "fake" }));
    for (const flag of ["--config", "-c"]) {
      const io = captureIO(tmp);
      expect(await main(["config", flag, "alt.json"], io)).toBe(0);
      expect(io.out()).toContain('"adapter": "fake"');
    }
  });

  it("exits 1 and prints each issue for an invalid config", async () => {
    await writeFile(
      join(tmp, "orc.config.json"),
      JSON.stringify({ retries: { maxPerTask: -1 }, extra: 1 }),
    );
    const io = captureIO(tmp);
    expect(await main(["config"], io)).toBe(1);
    expect(io.err()).toContain("has 2 problems:");
    expect(io.err()).toContain("  - retries.maxPerTask: must be an integer >= 0");
    expect(io.err()).toContain("  - extra: unknown key");
  });

  it("exits 1 when an explicit config file is missing", async () => {
    const io = captureIO(tmp);
    expect(await main(["config", "-c", "missing.json"], io)).toBe(1);
    expect(io.err()).toContain("config file not found");
  });
});
