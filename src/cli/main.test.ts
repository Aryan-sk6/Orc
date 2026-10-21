import { describe, expect, it } from "vitest";
import { captureIO } from "../../test/helpers/cli.js";
import { main } from "./main.js";
import { COMMANDS } from "./registry.js";

describe("main", () => {
  it("prints help listing every command and exits 0 with no arguments", async () => {
    const io = captureIO();
    expect(await main([], io)).toBe(0);
    expect(io.out()).toContain("Usage:");
    for (const command of COMMANDS) {
      expect(io.out()).toContain(`  ${command.name}`);
    }
    expect(io.err()).toBe("");
  });

  it("prints global help for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const io = captureIO();
      expect(await main([flag], io)).toBe(0);
      expect(io.out()).toContain("Commands:");
    }
  });

  it("prints command help for '<command> --help' in either order", async () => {
    for (const argv of [
      ["status", "--help"],
      ["-h", "status"],
    ]) {
      const io = captureIO();
      expect(await main(argv, io)).toBe(0);
      expect(io.out()).toMatch(/^Usage: orc status/);
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

  it("exits 2 on an option the command does not accept", async () => {
    const io = captureIO();
    expect(await main(["config", "--nope"], io)).toBe(2);
    expect(io.err()).toContain("--nope");
  });

  it("accepts global options before the command name", async () => {
    const io = captureIO();
    expect(await main(["-c", "test/fixtures/demo/orc.config.json", "config"], io)).toBe(0);
    expect(io.out()).toContain('"adapter": "fake"');
  });
});
