import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import type { CheckCommand } from "../config/types.js";
import { failedChecks, runCheck, runChecks } from "./run-checks.js";

const tmp = useTmpDir("orc-checks-");
const env = { PATH: process.env["PATH"] };

function check(command: string, timeoutMs = 20_000, name = "c"): CheckCommand {
  return { name, command, timeoutMs };
}

function options(extra: { signal?: AbortSignal; maxOutputChars?: number } = {}) {
  return { cwd: tmp(), env, now: () => new Date(), ...extra };
}

describe("runCheck", () => {
  it("passes on exit 0 and keeps the output", async () => {
    const result = await runCheck(check("echo hello"), options());
    expect(result).toMatchObject({
      status: "pass",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      output: "hello",
    });
  });

  it("fails on a non-zero exit and merges stdout and stderr", async () => {
    const result = await runCheck(check("echo out; echo err >&2; exit 3"), options());
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  it("runs in the given directory", async () => {
    const result = await runCheck(check("pwd"), options());
    expect(result.output.endsWith(tmp().split("/").pop() ?? "")).toBe(true);
  });

  it("kills a command that outlives its timeout, including its children", async () => {
    const started = Date.now();
    const result = await runCheck(check("sleep 30 & sleep 30", 200), options());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result).toMatchObject({ status: "fail", timedOut: true });
    expect(result.output).toContain("timed out after 200 ms");
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = runCheck(check("sleep 30"), options({ signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ status: "fail", aborted: true });
  });

  it("fails without starting when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runCheck(check("echo hi"), options({ signal: controller.signal }));
    expect(result.aborted).toBe(true);
    expect(result.status).toBe("fail");
  });

  it("keeps only the tail of long output", async () => {
    const result = await runCheck(
      check("i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i+1)); done"),
      options({ maxOutputChars: 100 }),
    );
    expect(result.output.length).toBeLessThanOrEqual(101);
    expect(result.output.startsWith("…")).toBe(true);
    expect(result.output.endsWith("line-1999")).toBe(true);
  });

  it("reports a missing working directory as a failed check, not an exception", async () => {
    const result = await runCheck(check("echo hi"), { ...options(), cwd: `${tmp()}/missing` });
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBeNull();
    expect(result.output).toContain("could not run the command");
  });

  it("does not leak undefined env values", async () => {
    const result = await runCheck(check('echo "[$FOO]"'), {
      ...options(),
      env: { PATH: process.env["PATH"], FOO: undefined },
    });
    expect(result.output).toBe("[]");
  });
});

describe("runChecks", () => {
  it("runs every check in order even after a failure", async () => {
    const results = await runChecks(
      [check("exit 1", 20_000, "a"), check("echo b", 20_000, "b")],
      options(),
    );
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["a", "fail"],
      ["b", "pass"],
    ]);
    expect(failedChecks(results).map((r) => r.name)).toEqual(["a"]);
  });

  it("stops at the first aborted check", async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runChecks([check("echo a"), check("echo b")], {
      ...options({ signal: controller.signal }),
    });
    expect(results).toHaveLength(1);
  });

  it("returns [] for no checks", async () => {
    expect(await runChecks([], options())).toEqual([]);
  });
});
