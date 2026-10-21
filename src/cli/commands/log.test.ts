import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-log-");

describe("orc log", () => {
  it("appends a line to <vault>/LOG.md and echoes it", async () => {
    const io = captureIO(tmp(), localTime(7));
    const argv = ["log", "added", "POST", "/todos", "-s", "api", "-t", "a.ts,b.ts", "-t", "c.ts"];
    expect(await main(argv, io)).toBe(0);

    const line = "[2026-10-21 22:07][api] added POST /todos | touching: a.ts, b.ts, c.ts";
    expect(io.out()).toBe(`${line}\n`);
    expect(await readFile(join(tmp(), "vault", "LOG.md"), "utf8")).toContain(`${line}\n`);
  });

  it("prints the last n entries with --tail", async () => {
    for (const did of ["one", "two", "three"]) {
      await main(["log", did, "--session", "web"], captureIO(tmp()));
    }
    const io = captureIO(tmp());
    expect(await main(["log", "--tail", "2"], io)).toBe(0);
    expect(io.out().trim().split("\n")).toEqual([
      "[2026-10-21 22:00][web] two | touching: -",
      "[2026-10-21 22:00][web] three | touching: -",
    ]);
  });

  it.each([
    [["log", "did something"], "--session is required"],
    [["log", "--tail", "x"], "--tail must be a non-negative integer"],
    [["log", "--tail", "3", "-s", "api"], "cannot be combined"],
  ])("exits 2 on bad usage %j", async (argv, message) => {
    const io = captureIO(tmp());
    expect(await main(argv, io)).toBe(2);
    expect(io.err()).toContain(message);
  });

  it("exits 1 on an invalid session name or empty message", async () => {
    let io = captureIO(tmp());
    expect(await main(["log", "x", "-s", "Bad Name"], io)).toBe(1);
    expect(io.err()).toContain("invalid session name");

    io = captureIO(tmp());
    expect(await main(["log", "-s", "api"], io)).toBe(1);
    expect(io.err()).toContain("must describe what was done");
  });
});
