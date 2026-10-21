import {
  ADAPTER_KINDS,
  type AdapterKind,
  type CheckCommandInput,
  type ModelConfigInput,
  type OrcConfig,
  type OrcConfigInput,
} from "./types.js";

export interface ConfigIssue {
  /** Dotted path to the offending value, e.g. "budgets.perTaskTokens" or "checks[1].name". "" is the root. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

type JsonObject = Readonly<Record<string, unknown>>;

const TOP_LEVEL_KEYS = [
  "vaultDir",
  "adapter",
  "planner",
  "driver",
  "budgets",
  "retries",
  "checks",
] as const;
const MODEL_KEYS = ["model"] as const;
const BUDGET_KEYS = ["perTaskTokens", "perRunTokens"] as const;
const RETRY_KEYS = ["maxPerTask"] as const;
const CHECK_KEYS = ["name", "command", "timeoutMs"] as const;

/** Checks the shape of parsed orc.config.json. Reports every issue, not just the first. */
export function validateConfigInput(raw: unknown): ValidationResult<OrcConfigInput> {
  const issues: ConfigIssue[] = [];
  if (!isJsonObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "config must be a JSON object" }] };
  }
  rejectUnknownKeys(raw, TOP_LEVEL_KEYS, "", issues);

  const planner = readSection(raw, "planner", MODEL_KEYS, "", issues);
  const driver = readSection(raw, "driver", MODEL_KEYS, "", issues);
  const budgets = readSection(raw, "budgets", BUDGET_KEYS, "", issues);
  const retries = readSection(raw, "retries", RETRY_KEYS, "", issues);

  const value: OrcConfigInput = {
    vaultDir: readString(raw, "vaultDir", "", issues),
    adapter: readAdapter(raw, issues),
    planner: planner && readModel(planner, "planner", issues),
    driver: driver && readModel(driver, "driver", issues),
    budgets: budgets && {
      perTaskTokens: readInteger(budgets, "perTaskTokens", 1, "budgets", issues),
      perRunTokens: readInteger(budgets, "perRunTokens", 1, "budgets", issues),
    },
    retries: retries && {
      maxPerTask: readInteger(retries, "maxPerTask", 0, "retries", issues),
    },
    checks: readChecks(raw, issues),
  };

  return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
}

/** Rules that span fields, checked after defaults are merged in. */
export function validateResolvedConfig(config: OrcConfig): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (config.budgets.perTaskTokens > config.budgets.perRunTokens) {
    issues.push({
      path: "budgets.perTaskTokens",
      message: `must not exceed budgets.perRunTokens (${config.budgets.perRunTokens})`,
    });
  }
  return issues;
}

function readModel(section: JsonObject, path: string, issues: ConfigIssue[]): ModelConfigInput {
  return { model: readString(section, "model", path, issues) };
}

function readAdapter(raw: JsonObject, issues: ConfigIssue[]): AdapterKind | undefined {
  const value = raw["adapter"];
  if (value === undefined) {
    return undefined;
  }
  if (isAdapterKind(value)) {
    return value;
  }
  issues.push({ path: "adapter", message: `must be one of: ${ADAPTER_KINDS.join(", ")}` });
  return undefined;
}

function readChecks(raw: JsonObject, issues: ConfigIssue[]): CheckCommandInput[] | undefined {
  const value = raw["checks"];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "checks", message: "must be an array" });
    return undefined;
  }

  const checks: CheckCommandInput[] = [];
  const seenNames = new Set<string>();
  value.forEach((item: unknown, index) => {
    const path = `checks[${index}]`;
    if (!isJsonObject(item)) {
      issues.push({ path, message: "must be an object" });
      return;
    }
    rejectUnknownKeys(item, CHECK_KEYS, path, issues);
    const name = readString(item, "name", path, issues, { required: true });
    const command = readString(item, "command", path, issues, { required: true });
    const timeoutMs = readInteger(item, "timeoutMs", 1, path, issues);
    if (name !== undefined && seenNames.has(name)) {
      issues.push({ path: `${path}.name`, message: `duplicate check name "${name}"` });
    }
    if (name !== undefined && command !== undefined) {
      seenNames.add(name);
      checks.push({ name, command, timeoutMs });
    }
  });
  return checks;
}

function readSection(
  parent: JsonObject,
  key: string,
  allowedKeys: readonly string[],
  parentPath: string,
  issues: ConfigIssue[],
): JsonObject | undefined {
  const value = parent[key];
  const path = joinPath(parentPath, key);
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    issues.push({ path, message: "must be an object" });
    return undefined;
  }
  rejectUnknownKeys(value, allowedKeys, path, issues);
  return value;
}

function readString(
  parent: JsonObject,
  key: string,
  parentPath: string,
  issues: ConfigIssue[],
  options: { readonly required?: boolean } = {},
): string | undefined {
  const value = parent[key];
  const path = joinPath(parentPath, key);
  if (value === undefined) {
    if (options.required === true) {
      issues.push({ path, message: "is required" });
    }
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path, message: "must be a non-empty string" });
    return undefined;
  }
  return value;
}

function readInteger(
  parent: JsonObject,
  key: string,
  min: number,
  parentPath: string,
  issues: ConfigIssue[],
): number | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    issues.push({ path: joinPath(parentPath, key), message: `must be an integer >= ${min}` });
    return undefined;
  }
  return value;
}

function rejectUnknownKeys(
  value: JsonObject,
  allowedKeys: readonly string[],
  path: string,
  issues: ConfigIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push({
        path: joinPath(path, key),
        message: `unknown key (allowed: ${allowedKeys.join(", ")})`,
      });
    }
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAdapterKind(value: unknown): value is AdapterKind {
  return ADAPTER_KINDS.some((kind) => kind === value);
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}
