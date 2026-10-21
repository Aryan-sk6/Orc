import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFixturePlan } from "../../test/helpers/plan.js";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { writeFileAtomic } from "../core/fs.js";
import { vaultPaths } from "../vault/layout.js";
import { checkSetup } from "./check-setup.js";

const tmp = useTmpDir("orc-setup-");

function vault() {
  return vaultPaths(join(tmp(), "vault"));
}

describe("checkSetup", () => {
  it("checks only the API key when there is no plan yet", async () => {
    const report = await checkSetup({ rootDir: tmp(), vault: vault(), env: {} });
    expect(report).toMatchObject({ planFound: false, ok: false, missing: 1, docs: [] });
    expect(report.envVars.map((v) => [v.name, v.foundIn])).toEqual([["ANTHROPIC_API_KEY", null]]);
  });

  it("finds env vars in the environment or .env files and checks docs", async () => {
    await writeFixturePlan(vault().root);
    await writeFile(join(tmp(), ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\n");
    await writeFile(
      join(tmp(), ".env"),
      "NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\n",
    );
    await writeFileAtomic(join(vault().docsDir, "supabase.md"), "# supabase-js\n...");
    await writeFileAtomic(join(vault().docsDir, "nextjs.md"), "  \n");

    const report = await checkSetup({
      rootDir: tmp(),
      vault: vault(),
      env: { ANTHROPIC_API_KEY: "sk-test", SENTRY_DSN: "" },
    });

    expect(report.envVars.map((v) => [v.name, v.required, v.foundIn])).toEqual([
      ["ANTHROPIC_API_KEY", true, "environment"],
      ["NEXT_PUBLIC_SUPABASE_URL", true, ".env.local"],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", true, null],
      ["SENTRY_DSN", false, null],
    ]);
    expect(report.docs.map((d) => [d.file, d.status])).toEqual([
      ["supabase.md", "ok"],
      ["nextjs.md", "empty"],
    ]);
    expect(report).toMatchObject({ planFound: true, missing: 2, ok: false, planProblems: [] });
  });

  it("passes when everything required is in place, ignoring optional vars", async () => {
    await writeFixturePlan(vault().root);
    await writeFileAtomic(join(vault().docsDir, "supabase.md"), "docs");
    await writeFileAtomic(join(vault().docsDir, "nextjs.md"), "docs");
    const report = await checkSetup({
      rootDir: tmp(),
      vault: vault(),
      env: {
        ANTHROPIC_API_KEY: "sk",
        NEXT_PUBLIC_SUPABASE_URL: "u",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "k",
      },
    });
    expect(report).toMatchObject({ ok: true, missing: 0 });
  });

  it("does not accept the API key from a .env file, but says where it is", async () => {
    await writeFile(join(tmp(), ".env"), "ANTHROPIC_API_KEY=sk-in-file\n");
    const report = await checkSetup({ rootDir: tmp(), vault: vault(), env: {} });
    expect(report.envVars[0]).toMatchObject({
      foundIn: null,
      note: "found in .env, but orc doesn't load .env files: export it in your shell",
    });
  });

  it("reports plan problems in setup.md and a missing docs-needed.md", async () => {
    await writeFileAtomic(join(vault().planDir, "setup.md"), "# Setup\n");
    const report = await checkSetup({
      rootDir: tmp(),
      vault: vault(),
      env: { ANTHROPIC_API_KEY: "k" },
    });
    expect(report.planProblems).toEqual([
      'plan/setup.md: missing "## Env vars" section',
      "plan/docs-needed.md: not found",
    ]);
    expect(report.ok).toBe(false);
  });
});
