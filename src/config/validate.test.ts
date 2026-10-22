import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type ConfigIssue, validateConfigInput } from "./validate.js";

const FIXTURES = new URL("../../test/fixtures/configs/", import.meta.url);

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}

function issuePaths(raw: unknown): string[] {
  const result = validateConfigInput(raw);
  return result.ok ? [] : result.issues.map((issue: ConfigIssue) => issue.path);
}

describe("validateConfigInput", () => {
  it("accepts an empty object", () => {
    expect(validateConfigInput({})).toEqual({ ok: true, value: expect.any(Object) });
  });

  it("accepts a partial config and keeps only what was given", async () => {
    const result = validateConfigInput(await readFixture("partial.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adapter).toBe("fake");
      expect(result.value.retries?.maxPerTask).toBe(0);
      expect(result.value.planner).toBeUndefined();
      expect(result.value.checks).toEqual([
        { name: "test", command: "pnpm test", timeoutMs: undefined },
      ]);
    }
  });

  it.each([null, [], "config", 3])("rejects a non-object root (%j)", (raw) => {
    expect(issuePaths(raw)).toEqual([""]);
  });

  it("reports every problem in one pass, with paths", async () => {
    expect(issuePaths(await readFixture("invalid.json")).sort()).toEqual(
      [
        "verbose",
        "vaultDir",
        "adapter",
        "planner",
        "maxBudgetUsd",
        "budgets",
        "retries.maxPerTask",
        "checks[1].name",
        "checks[1].command",
        "checks[2]",
      ].sort(),
    );
  });

  it("explains what is allowed for unknown keys and bad enums", () => {
    const result = validateConfigInput({ adapter: "codex", driver: { modle: "x" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: "adapter",
        message: "must be one of: claude-agent-sdk, fake",
      });
      expect(result.issues).toContainEqual({
        path: "driver.modle",
        message: "unknown key (allowed: model)",
      });
    }
  });

  it("requires name and command on each check", () => {
    expect(issuePaths({ checks: [{ timeoutMs: 5 }] })).toEqual([
      "checks[0].name",
      "checks[0].command",
    ]);
  });

  it("rejects non-integer, unsafe, and below-minimum counts", () => {
    for (const bad of [-1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
      expect(issuePaths({ retries: { maxPerTask: bad } })).toEqual(["retries.maxPerTask"]);
    }
    expect(issuePaths({ retries: { maxPerTask: 0 } })).toEqual([]);
  });

  it("requires maxBudgetUsd to be a finite number > 0 (the SDK rejects 0)", () => {
    for (const bad of [0, -5, "20", Number.POSITIVE_INFINITY, null]) {
      expect(issuePaths({ maxBudgetUsd: bad })).toEqual(["maxBudgetUsd"]);
    }
    expect(issuePaths({ maxBudgetUsd: 0.5 })).toEqual([]);
  });

  it("accepts an empty installCommand (none) but not a non-string one", () => {
    expect(validateConfigInput({ installCommand: "" })).toEqual({
      ok: true,
      value: expect.objectContaining({ installCommand: "" }),
    });
    expect(issuePaths({ installCommand: 3 })).toEqual(["installCommand"]);
  });

  it("rejects the removed token budgets as unknown keys", () => {
    expect(issuePaths({ budgets: { perRunTokens: 100 } })).toEqual(["budgets"]);
  });

  it("rejects blank strings", () => {
    expect(issuePaths({ vaultDir: "  ", planner: { model: "" } })).toEqual([
      "vaultDir",
      "planner.model",
    ]);
  });
});
