import { join } from "node:path";
import { parseEnvFile } from "../core/env-file.js";
import { readFileIfExists } from "../core/fs.js";
import type { VaultPaths } from "../vault/layout.js";
import { PLAN_FILES, parseDocsNeeded, parseSetup } from "../vault/plan.js";

/*
 * `orc check-setup`: deterministic presence checks, no network calls.
 * Values are never read into the report, only whether they are set.
 */

/** orc itself needs this; it is checked even before a plan exists. */
export const API_KEY_VAR = "ANTHROPIC_API_KEY";

/** Checked in this order after the environment; the first non-empty value wins. */
export const ENV_FILES: readonly string[] = [".env.local", ".env"];

export interface EnvCheck {
  readonly name: string;
  readonly purpose: string;
  readonly required: boolean;
  /** Where a non-empty value was found: "environment", ".env.local", ".env", or null. */
  readonly foundIn: string | null;
  /** Extra hint, e.g. that the API key is in a .env file orc does not load. */
  readonly note: string;
}

export interface DocCheck {
  readonly file: string;
  readonly description: string;
  readonly status: "ok" | "missing" | "empty";
}

export interface SetupReport {
  readonly rootDir: string;
  readonly docsDir: string;
  /** False when plan/setup.md does not exist yet: only the API key was checked. */
  readonly planFound: boolean;
  readonly envVars: readonly EnvCheck[];
  readonly docs: readonly DocCheck[];
  /** Plan files that are missing or don't parse. */
  readonly planProblems: readonly string[];
  /** Required env vars and docs that are not in place. */
  readonly missing: number;
  readonly ok: boolean;
}

export interface CheckSetupOptions {
  /** The target app's root, where .env files are looked up. */
  readonly rootDir: string;
  readonly vault: VaultPaths;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export async function checkSetup(options: CheckSetupOptions): Promise<SetupReport> {
  const { vault } = options;
  const envFiles = await readEnvFiles(options.rootDir);
  const planProblems: string[] = [];

  const setupText = await readFileIfExists(join(vault.root, PLAN_FILES.setup));
  const docsText = await readFileIfExists(join(vault.root, PLAN_FILES.docsNeeded));
  const planFound = setupText !== null;

  const envVars: EnvCheck[] = [apiKeyCheck(options.env, envFiles)];
  if (setupText !== null) {
    const parsed = parseSetup(setupText);
    if (parsed.ok) {
      for (const variable of parsed.value) {
        if (variable.name !== API_KEY_VAR) {
          envVars.push({
            name: variable.name,
            purpose: variable.purpose,
            required: !variable.optional,
            foundIn: findVar(variable.name, options.env, envFiles),
            note: "",
          });
        }
      }
    } else {
      planProblems.push(...parsed.issues);
    }
  }

  const docs: DocCheck[] = [];
  if (docsText === null) {
    if (planFound) {
      planProblems.push(`${PLAN_FILES.docsNeeded}: not found`);
    }
  } else {
    const parsed = parseDocsNeeded(docsText);
    if (parsed.ok) {
      for (const doc of parsed.value) {
        const content = await readFileIfExists(join(vault.docsDir, doc.file));
        const status = content === null ? "missing" : content.trim() === "" ? "empty" : "ok";
        docs.push({ file: doc.file, description: doc.description, status });
      }
    } else {
      planProblems.push(...parsed.issues);
    }
  }

  const missing =
    envVars.filter((v) => v.required && v.foundIn === null).length +
    docs.filter((d) => d.status !== "ok").length;
  return {
    rootDir: options.rootDir,
    docsDir: vault.docsDir,
    planFound,
    envVars,
    docs,
    planProblems,
    missing,
    ok: planFound && missing === 0 && planProblems.length === 0,
  };
}

function apiKeyCheck(
  env: Readonly<Record<string, string | undefined>>,
  envFiles: ReadonlyMap<string, ReadonlyMap<string, string>>,
): EnvCheck {
  const inEnvironment = isSet(env[API_KEY_VAR]);
  const inFile = findVar(API_KEY_VAR, {}, envFiles);
  return {
    name: API_KEY_VAR,
    purpose: "orc's planner and drivers call Claude with it",
    required: true,
    foundIn: inEnvironment ? "environment" : null,
    note:
      !inEnvironment && inFile !== null
        ? `found in ${inFile}, but orc doesn't load .env files: export it in your shell`
        : "",
  };
}

function findVar(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  envFiles: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | null {
  if (isSet(env[name])) {
    return "environment";
  }
  for (const [file, vars] of envFiles) {
    if (isSet(vars.get(name))) {
      return file;
    }
  }
  return null;
}

async function readEnvFiles(rootDir: string): Promise<Map<string, Map<string, string>>> {
  const files = new Map<string, Map<string, string>>();
  for (const file of ENV_FILES) {
    const text = await readFileIfExists(join(rootDir, file));
    if (text !== null) {
      files.set(file, parseEnvFile(text));
    }
  }
  return files;
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}
