import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { writeFixturePlan } from "../../../test/helpers/plan.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { writeFileAtomic } from "../../core/fs.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-setup-cmd-");

describe("orc check-setup", () => {
  it("lists what is missing without printing any values, and exits 1", async () => {
    await writeFixturePlan(join(tmp(), "vault"));
    await writeFileAtomic(join(tmp(), "vault/docs/supabase.md"), "docs");
    await writeFile(join(tmp(), ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=https://secret.example\n");
    const io = captureIO(tmp(), localTime(), { env: { ANTHROPIC_API_KEY: "sk-secret" } });

    expect(await main(["check-setup"], io)).toBe(1);
    const out = io.out();
    expect(out).not.toContain("secret");
    expect(out).toContain(`Setup check for ${tmp()}`);
    expect(out).toMatch(/ok\s+ANTHROPIC_API_KEY\s+environment/);
    expect(out).toMatch(/ok\s+NEXT_PUBLIC_SUPABASE_URL\s+\.env\.local/);
    expect(out).toMatch(/MISSING\s+NEXT_PUBLIC_SUPABASE_ANON_KEY\s+Supabase anon key/);
    expect(out).toMatch(/optional\s+SENTRY_DSN\s+not set: Sentry project DSN/);
    expect(out).toContain("Docs (vault/docs/)");
    expect(out).toMatch(/MISSING\s+nextjs\.md\s+Next\.js 15 server actions/);
    expect(out).toContain('2 missing. Fix them, then run "orc check-setup" again.');
  });

  it("exits 0 when setup is complete", async () => {
    await writeFixturePlan(join(tmp(), "vault"));
    await writeFileAtomic(join(tmp(), "vault/docs/supabase.md"), "docs");
    await writeFileAtomic(join(tmp(), "vault/docs/nextjs.md"), "docs");
    const io = captureIO(tmp(), localTime(), {
      env: {
        ANTHROPIC_API_KEY: "k",
        NEXT_PUBLIC_SUPABASE_URL: "u",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
      },
    });
    expect(await main(["check-setup"], io)).toBe(0);
    expect(io.out()).toContain("Setup complete.");
  });

  it("says to run orc plan first when there is no plan", async () => {
    const io = captureIO(tmp(), localTime(), { env: { ANTHROPIC_API_KEY: "k" } });
    expect(await main(["check-setup"], io)).toBe(1);
    expect(io.out()).toContain("No plan yet (plan/setup.md not found)");
    expect(io.out()).toContain('Run "orc plan <idea.md>" first.');
  });

  it("prints a JSON report with --json", async () => {
    const io = captureIO(tmp(), localTime(), { env: {} });
    expect(await main(["check-setup", "--json"], io)).toBe(1);
    const report: unknown = JSON.parse(io.out());
    expect(report).toMatchObject({ planFound: false, missing: 1, ok: false });
  });
});
