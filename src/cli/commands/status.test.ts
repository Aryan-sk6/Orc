import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";
import { formatChecksCell, type StatusReport } from "./status.js";

const DEMO_CONFIG = fileURLToPath(
  new URL("../../../test/fixtures/demo/orc.config.json", import.meta.url),
);
const tmp = useTmpDir("orc-cli-status-");

describe("orc status on the demo vault (fake data)", () => {
  it("renders one row per session, the token total and open decisions", async () => {
    const io = captureIO();
    expect(await main(["status", "-c", DEMO_CONFIG], io)).toBe(0);
    expect(io.err()).toBe("");
    expect(io.out()).toMatchInlineSnapshot(`
      "SESSION  STATUS    TASK                                      DONE  CHECKS       TOKENS  UPDATED
      api      running   T3 Add POST /todos route with validation   2/5  fail: lint   48,210  2026-10-21 22:41
      auth     paused    T2 Session cookies                         1/3  fail: test  152,340  2026-10-21 22:38
      db       done      -                                          3/3  4/4 pass     27,770  2026-10-21 22:20
      web      checking  T2 Todo list component                     1/4  2/4 pass     31,005  2026-10-21 22:43

      Tokens: 259,325 of 2,000,000 run cap (13.0%)
      Open decisions: 1 (see decisions.md)
      "
    `);
  });

  it("prints a JSON report with --json", async () => {
    const io = captureIO();
    expect(await main(["status", "--json", "-c", DEMO_CONFIG], io)).toBe(0);
    const report: unknown = JSON.parse(io.out());
    expect(report).toMatchObject({
      sessions: [
        { session: "api", status: "running", tasksDone: 2, tasksTotal: 5 },
        { session: "auth", status: "paused" },
        { session: "db", status: "done", currentTask: null },
        { session: "web", status: "checking" },
      ],
      tokensSpent: 48_210 + 152_340 + 27_770 + 31_005,
      perRunTokens: 2_000_000,
      openDecisions: 1,
      invalidNotes: [],
    } satisfies Partial<Record<keyof StatusReport, unknown>>);
  });
});

describe("orc status edge cases", () => {
  it("says so when the vault has no sessions yet", async () => {
    await mkdir(join(tmp(), "vault"));
    const io = captureIO(tmp());
    expect(await main(["status"], io)).toBe(0);
    expect(io.out()).toBe(`No sessions yet in ${join(tmp(), "vault")}/sessions.\n`);
  });

  it("exits 1 with a hint when the vault does not exist", async () => {
    const io = captureIO(tmp());
    expect(await main(["status"], io)).toBe(1);
    expect(io.err()).toContain(`no vault at ${join(tmp(), "vault")}`);
  });

  it("still renders valid sessions and reports invalid notes on stderr", async () => {
    const sessions = join(tmp(), "vault", "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "broken.md"), "---\nsession: broken\nstatus: lost\n---\n");
    const io = captureIO(tmp());
    expect(await main(["status"], io)).toBe(0);
    expect(io.out()).toContain("No sessions yet");
    expect(io.err()).toContain("skipped");
    expect(io.err()).toContain("status: must be one of");
  });
});

describe("formatChecksCell", () => {
  it("summarizes check results", () => {
    expect(formatChecksCell([])).toBe("-");
    expect(
      formatChecksCell([
        { name: "typecheck", status: "pass" },
        { name: "lint", status: "fail" },
        { name: "test", status: "fail" },
      ]),
    ).toBe("fail: lint, test");
    expect(
      formatChecksCell([
        { name: "typecheck", status: "pass" },
        { name: "lint", status: "pending" },
      ]),
    ).toBe("1/2 pass");
  });
});
