import { join } from "node:path";
import { readFileIfExists } from "../core/fs.js";
import type { VaultPaths } from "../vault/layout.js";
import { PLAN_FILES, type Plan, type Workstream, workstreamNotePath } from "../vault/plan.js";

export interface ContextFile {
  /** Vault-relative path, e.g. "contracts/api.ts" or "docs/clerk.md". */
  readonly path: string;
  readonly content: string;
}

/** Everything from the vault that coding and driver prompts are built from. Read once per run. */
export interface SessionContext {
  /** plan/agents.md: the target app's agents.md. */
  readonly agentsMd: string;
  /** The workstream's own plan note. */
  readonly workstreamNote: string;
  readonly contracts: readonly ContextFile[];
  /** Docs listed in plan/docs-needed.md that exist in docs/. */
  readonly docs: readonly ContextFile[];
  /** The user's standing preferences (rules.md). */
  readonly rules: string;
}

/** Per-file and per-section limits keep driver prompts short (the driver is a small model). */
export const MAX_FILE_CHARS = 8000;

export async function loadSessionContext(
  vault: VaultPaths,
  plan: Plan,
  workstream: Workstream,
): Promise<SessionContext> {
  const read = async (relativePath: string): Promise<ContextFile | null> => {
    const content = await readFileIfExists(join(vault.root, ...relativePath.split("/")));
    return content === null ? null : { path: relativePath, content };
  };
  const present = async (paths: readonly string[]): Promise<ContextFile[]> =>
    (await Promise.all(paths.map(read))).filter((file): file is ContextFile => file !== null);

  return {
    agentsMd: (await readFileIfExists(join(vault.root, ...PLAN_FILES.agents.split("/")))) ?? "",
    workstreamNote: (await readFileIfExists(workstreamNotePath(vault, workstream.name))) ?? "",
    contracts: await present(plan.contracts),
    docs: await present(plan.docs.map((doc) => `docs/${doc.file}`)),
    rules: (await readFileIfExists(vault.rules)) ?? "",
  };
}

/** Docs whose file name or stem (e.g. "clerk") appears in any of `texts`, case-insensitively. */
export function relevantDocs(
  docs: readonly ContextFile[],
  texts: readonly string[],
): ContextFile[] {
  const haystack = texts.join("\n").toLowerCase();
  return docs.filter((doc) => {
    const file = doc.path.slice(doc.path.lastIndexOf("/") + 1).toLowerCase();
    const stem = file.replace(/\.md$/, "");
    return haystack.includes(file) || haystack.includes(stem);
  });
}

export function clip(text: string, maxChars: number = MAX_FILE_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars
    ? trimmed
    : `${trimmed.slice(0, maxChars)}\n…(truncated, ${trimmed.length - maxChars} more characters)`;
}
