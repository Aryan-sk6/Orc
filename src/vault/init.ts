import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileIfMissing } from "../core/fs.js";
import { DECISIONS_HEADER } from "./decisions.js";
import type { VaultPaths } from "./layout.js";
import { LOG_HEADER } from "./log.js";

export const RULES_TEMPLATE =
  "# Rules\n\nStanding preferences, read by every driver. One bullet per rule.\n\n";

export const DOCS_README =
  "# Docs\n\nPaste current third-party docs here (one file per library) so agents never rely on outdated training data.\n";

/** Creates the vault folders and seed files that are missing. Never overwrites. Returns created paths. */
export async function ensureVault(paths: VaultPaths): Promise<string[]> {
  const dirs = [paths.root, paths.sessionsDir, paths.planDir, paths.contractsDir, paths.docsDir];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  const seeds: ReadonlyArray<readonly [string, string]> = [
    [paths.log, LOG_HEADER],
    [paths.decisions, DECISIONS_HEADER],
    [paths.rules, RULES_TEMPLATE],
    [join(paths.docsDir, "README.md"), DOCS_README],
  ];
  const created: string[] = [];
  for (const [file, content] of seeds) {
    if (await writeFileIfMissing(file, content)) {
      created.push(file);
    }
  }
  return created;
}
