import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const FIXTURES = fileURLToPath(new URL("../../../test/fixtures/planner/", import.meta.url));
const tmp = useTmpDir("orc-plan-cmd-");

async function project(): Promise<string> {
  const dir = join(tmp(), "app");
  await cp(FIXTURES, dir, { recursive: true });
  return dir;
}

describe("orc plan", () => {
  it("asks each question, takes typed answers or defaults, and writes the plan", async () => {
    const dir = await project();
    const io = captureIO(dir, localTime(7), { input: ["Remix", "", "Clerk"] });
    expect(await main(["plan", "idea.md"], io)).toBe(0);

    const out = io.out();
    expect(out).toContain("Asking the planner for clarifying questions…");
    expect(out).toContain(
      "\nQuestion 1/10: Which frontend framework?\n  Why: Shapes the folder structure and routing.\n  Default: Next.js 15 App Router (press Enter to accept)\n> Remix\n",
    );
    // Input ran out after 3 lines: the rest use defaults without blocking.
    expect(out).toContain("Question 4/10: Do todos need due dates?");
    expect(out).toContain("> (no input; using the default)");
    expect(out).toContain("Plan written to ");
    expect(out).toContain("  plan/workstreams/api.md\n");
    expect(out).toContain("Workstreams: api (2 tasks, waits on web); web (3 tasks, waits on api)");
    expect(out).toContain("Planner: 2 turns, $0.35 (Agent SDK estimate, not billing data)");
    expect(out).toContain("run: orc check-setup");
    expect(io.err()).toBe(
      "orc: warning: input ended early: the planner's defaults were used for 7 question(s)\n",
    );

    const questions = await readFile(join(dir, "vault/plan/questions.md"), "utf8");
    expect(questions).toContain("**Answer:** Remix\n");
    expect(questions).toContain("**Answer:** Postgres on Supabase *(planner default)*");
    expect(questions).toContain("**Answer:** Clerk\n");
    const log = await readFile(join(dir, "vault/LOG.md"), "utf8");
    expect(log).toContain("[2026-10-21 22:07][planner] wrote plan: 2 workstreams, 5 tasks");
  });

  it("--defaults never reads stdin", async () => {
    const dir = await project();
    const io = captureIO(dir, localTime(), { input: ["should not be read"] });
    expect(await main(["plan", "idea.md", "--defaults"], io)).toBe(0);
    expect(io.out()).not.toContain("> ");
    expect(io.err()).toBe("");
  });

  it("refuses to replace a plan without --force", async () => {
    const dir = await project();
    expect(await main(["plan", "idea.md", "--defaults"], captureIO(dir))).toBe(0);
    const again = captureIO(dir);
    expect(await main(["plan", "idea.md", "--defaults"], again)).toBe(1);
    expect(again.err()).toContain("a plan already exists");
    expect(again.err()).toContain("--force");
  });

  it("reports a missing or empty idea file and a missing argument", async () => {
    const dir = await project();
    const missing = captureIO(dir);
    expect(await main(["plan", "nope.md"], missing)).toBe(1);
    expect(missing.err()).toContain("idea file not found");

    await writeFile(join(dir, "empty.md"), "  \n");
    const empty = captureIO(dir);
    expect(await main(["plan", "empty.md"], empty)).toBe(1);
    expect(empty.err()).toContain("idea file is empty");

    const usage = captureIO(dir);
    expect(await main(["plan"], usage)).toBe(2);
  });

  it("stops before any model call when the SDK adapter has no API key", async () => {
    const dir = await project();
    await writeFile(join(dir, "orc.config.json"), "{}");
    const io = captureIO(dir, undefined, { env: {} });
    expect(await main(["plan", "idea.md"], io)).toBe(1);
    expect(io.err()).toContain("ANTHROPIC_API_KEY is not set");
  });
});
