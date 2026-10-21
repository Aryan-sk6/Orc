import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { ensureVault, RULES_TEMPLATE } from "./init.js";
import { VAULT_LAYOUT, vaultPaths } from "./layout.js";

const tmp = useTmpDir("orc-init-");

describe("ensureVault", () => {
  it("creates the spec layout", async () => {
    const paths = vaultPaths(join(tmp(), "vault"));
    const created = await ensureVault(paths);
    expect((await readdir(paths.root)).sort()).toEqual(
      [
        VAULT_LAYOUT.contractsDir,
        VAULT_LAYOUT.decisions,
        VAULT_LAYOUT.docsDir,
        VAULT_LAYOUT.log,
        VAULT_LAYOUT.planDir,
        VAULT_LAYOUT.rules,
        VAULT_LAYOUT.sessionsDir,
      ].sort(),
    );
    expect(created).toHaveLength(4);
    expect(await readFile(paths.rules, "utf8")).toBe(RULES_TEMPLATE);
  });

  it("never overwrites existing files and is idempotent", async () => {
    const paths = vaultPaths(tmp());
    await ensureVault(paths);
    await writeFile(paths.rules, "# Rules\n- use pnpm\n");
    expect(await ensureVault(paths)).toEqual([]);
    expect(await readFile(paths.rules, "utf8")).toBe("# Rules\n- use pnpm\n");
  });
});
