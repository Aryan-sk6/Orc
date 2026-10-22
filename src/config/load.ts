import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { errorCode, errorMessage, OrcError } from "../core/errors.js";
import { DEFAULT_CHECK_TIMEOUT_MS, DEFAULT_CONFIG } from "./defaults.js";
import type { OrcConfig, OrcConfigInput } from "./types.js";
import { type ConfigIssue, type ValidationResult, validateConfigInput } from "./validate.js";

export const CONFIG_FILENAME = "orc.config.json";

export interface LoadConfigOptions {
  /** Directory searched for orc.config.json when `path` is not given. */
  readonly cwd: string;
  /** Explicit config file, relative to `cwd`. When given, the file must exist. */
  readonly path?: string | undefined;
}

export interface LoadedConfig {
  readonly config: OrcConfig;
  /** Absolute path of the file read, or null when none exists and only defaults apply. */
  readonly sourcePath: string | null;
  /** Directory that relative paths in the config resolve against: the file's dir, else `cwd`. */
  readonly rootDir: string;
  /** `config.vaultDir` resolved against `rootDir`. */
  readonly vaultPath: string;
}

/**
 * Reads orc.config.json, validates it, and fills in defaults.
 * A missing default config file is fine (all defaults); a missing explicit `path` is an error.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const filePath = resolve(options.cwd, options.path ?? CONFIG_FILENAME);
  const text = await readConfigText(filePath, options.path !== undefined);
  if (text === null) {
    return withPaths(DEFAULT_CONFIG, null, options.cwd);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new OrcError(
      "CONFIG_INVALID_JSON",
      `${filePath} is not valid JSON: ${errorMessage(error)}`,
    );
  }

  const result = parseConfig(raw);
  if (!result.ok) {
    const count = result.issues.length;
    throw new OrcError(
      "CONFIG_INVALID",
      `${filePath} has ${count} problem${count === 1 ? "" : "s"}:`,
      result.issues.map(formatIssue),
    );
  }
  return withPaths(result.value, filePath, dirname(filePath));
}

/** Validates already-parsed JSON and merges defaults. Pure; no I/O. */
export function parseConfig(raw: unknown): ValidationResult<OrcConfig> {
  const input = validateConfigInput(raw);
  return input.ok ? { ok: true, value: resolveConfig(input.value) } : input;
}

export function resolveConfig(
  input: OrcConfigInput,
  defaults: OrcConfig = DEFAULT_CONFIG,
): OrcConfig {
  return {
    vaultDir: input.vaultDir ?? defaults.vaultDir,
    adapter: input.adapter ?? defaults.adapter,
    fakeScript: input.fakeScript ?? defaults.fakeScript,
    planner: { model: input.planner?.model ?? defaults.planner.model },
    coder: { model: input.coder?.model ?? defaults.coder.model },
    driver: { model: input.driver?.model ?? defaults.driver.model },
    maxBudgetUsd: input.maxBudgetUsd ?? defaults.maxBudgetUsd,
    retries: { maxPerTask: input.retries?.maxPerTask ?? defaults.retries.maxPerTask },
    checks:
      input.checks?.map((check) => ({
        name: check.name,
        command: check.command,
        timeoutMs: check.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
      })) ?? defaults.checks,
    installCommand: input.installCommand ?? defaults.installCommand,
  };
}

export function formatIssue(issue: ConfigIssue): string {
  return `${issue.path === "" ? "(root)" : issue.path}: ${issue.message}`;
}

async function readConfigText(filePath: string, required: boolean): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (!required) {
        return null;
      }
      throw new OrcError("CONFIG_NOT_FOUND", `config file not found: ${filePath}`);
    }
    throw new OrcError("CONFIG_UNREADABLE", `cannot read ${filePath}: ${errorMessage(error)}`);
  }
}

function withPaths(config: OrcConfig, sourcePath: string | null, rootDir: string): LoadedConfig {
  return { config, sourcePath, rootDir, vaultPath: resolve(rootDir, config.vaultDir) };
}
