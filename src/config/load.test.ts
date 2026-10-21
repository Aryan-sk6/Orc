import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrcError } from "../core/errors.js";
import { DEFAULT_CHECK_TIMEOUT_MS, DEFAULT_CONFIG } from "./defaults.js";
import { CONFIG_FILENAME, loadConfig, parseConfig } from "./load.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../test/fixtures/configs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "orc-config-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function expectOrcError(promise: Promise<unknown>): Promise<OrcError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OrcError);
  if (!(error instanceof OrcError)) {
    throw new Error("unreachable");
  }
  return error;
}

describe("parseConfig", () => {
  it("returns the defaults for an empty object", () => {
    expect(parseConfig({})).toEqual({ ok: true, value: DEFAULT_CONFIG });
  });

  it("merges a partial config over the defaults", () => {
    const result = parseConfig({
      driver: { model: "claude-sonnet-5-5" },
      maxBudgetUsd: 7.5,
    });
    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_CONFIG, driver: { model: "claude-sonnet-5-5" }, maxBudgetUsd: 7.5 },
    });
  });

  it("replaces the default checks wholesale and fills in timeouts", () => {
    const result = parseConfig({ checks: [{ name: "test", command: "pnpm test" }] });
    expect(result.ok && result.value.checks).toEqual([
      { name: "test", command: "pnpm test", timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
    ]);
  });

  it("allows an empty checks list", () => {
    const result = parseConfig({ checks: [] });
    expect(result.ok && result.value.checks).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("uses defaults when there is no orc.config.json in cwd", async () => {
    const loaded = await loadConfig({ cwd: tmp });
    expect(loaded).toEqual({
      config: DEFAULT_CONFIG,
      sourcePath: null,
      rootDir: tmp,
      vaultPath: join(tmp, "vault"),
    });
  });

  it("reads orc.config.json from cwd", async () => {
    await writeFile(join(tmp, CONFIG_FILENAME), JSON.stringify({ adapter: "fake" }));
    const loaded = await loadConfig({ cwd: tmp });
    expect(loaded.sourcePath).toBe(join(tmp, CONFIG_FILENAME));
    expect(loaded.config.adapter).toBe("fake");
  });

  it("resolves vaultDir against the config file's directory, not cwd", async () => {
    const loaded = await loadConfig({ cwd: tmp, path: join(FIXTURES_DIR, "partial.json") });
    expect(loaded.rootDir).toBe(FIXTURES_DIR);
    expect(loaded.vaultPath).toBe(join(FIXTURES_DIR, "notes"));
    expect(loaded.config.retries.maxPerTask).toBe(0);
  });

  it("resolves a relative explicit path against cwd", async () => {
    await mkdir(join(tmp, "cfg"));
    await writeFile(join(tmp, "cfg", "orc.json"), "{}");
    const loaded = await loadConfig({ cwd: tmp, path: "cfg/orc.json" });
    expect(loaded.sourcePath).toBe(join(tmp, "cfg", "orc.json"));
    expect(loaded.vaultPath).toBe(join(tmp, "cfg", "vault"));
  });

  it("fails with CONFIG_NOT_FOUND when an explicit path is missing", async () => {
    const error = await expectOrcError(loadConfig({ cwd: tmp, path: "nope.json" }));
    expect(error.code).toBe("CONFIG_NOT_FOUND");
    expect(error.message).toContain(join(tmp, "nope.json"));
  });

  it("fails with CONFIG_UNREADABLE when the path is a directory", async () => {
    await mkdir(join(tmp, CONFIG_FILENAME));
    const error = await expectOrcError(loadConfig({ cwd: tmp }));
    expect(error.code).toBe("CONFIG_UNREADABLE");
  });

  it("fails with CONFIG_INVALID_JSON on malformed JSON", async () => {
    await writeFile(join(tmp, CONFIG_FILENAME), '{ "adapter": "fake", }');
    const error = await expectOrcError(loadConfig({ cwd: tmp }));
    expect(error.code).toBe("CONFIG_INVALID_JSON");
  });

  it("fails with CONFIG_INVALID and lists every issue", async () => {
    const error = await expectOrcError(
      loadConfig({ cwd: tmp, path: join(FIXTURES_DIR, "invalid.json") }),
    );
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toMatch(/has 10 problems:$/);
    expect(error.details).toContain("adapter: must be one of: claude-agent-sdk, fake");
    expect(error.details).toContain("checks[2]: must be an object");
  });
});

describe("orc.config.example.json", () => {
  it("documents exactly the defaults", async () => {
    const example: unknown = JSON.parse(
      await readFile(join(REPO_ROOT, "orc.config.example.json"), "utf8"),
    );
    expect(example).toEqual(DEFAULT_CONFIG);
  });
});
