import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { vaultPaths } from "../../vault/layout.js";
import { writeSessionState } from "../../vault/session-note.js";
import { main } from "../main.js";
import { formatChecksCell, formatUsd, renderStatus, type StatusReport } from "./status.js";

const DEMO_CONFIG = fileURLToPath(
  new URL("../../../test/fixtures/demo/orc.config.json", import.meta.url),
);
const tmp = useTmpDir("orc-cli-status-");

describe("orc status on the demo vault (fake data)", () => {
  it("renders one row per session, estimated spend vs the run cap, and open decisions", async () => {
    const io = captureIO();
    expect(await main(["status", "-c", DEMO_CONFIG], io)).toBe(0);
    expect(io.err()).toBe("");
    expect(io.out()).toMatchInlineSnapshot(`
      "SESSION  STATUS    TASK                                      DONE  CHECKS        COST  UPDATED
      api      running   T3 Add POST /todos route with validation   2/5  fail: lint   $0.48  2026-10-21 22:41
      auth     paused    T2 Session cookies                         1/3  fail: test   $1.62  2026-10-21 22:38
      db       done      -                                          3/3  4/4 pass     $0.28  2026-10-21 22:20
      web      checking  T2 Todo list component                     1/4  2/4 pass    <$0.01  2026-10-21 22:43

      Spend: $2.39 of $5.00 run cap (47.7%), estimated by the Agent SDK, not billing data
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
      costUsd: 2.3863,
      maxBudgetUsd: 5,
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

describe("formatUsd", () => {
  it("shows dollars with cents, and <$0.01 for tiny non-zero amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0031)).toBe("<$0.01");
    expect(formatUsd(0.005)).toBe("$0.01");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
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

describe("renderStatus after a restart", () => {
  const session = {
    session: "api",
    workstream: "api",
    branch: "orc/api",
    status: "paused",
    currentTask: "T2 Add tests",
    tasksDone: 1,
    tasksTotal: 2,
    checks: [],
    costUsd: 1,
    agentSession: "s1",
    updated: "2026-10-22 10:00",
  } as const;
  const report = (costMayBeOvercounted: boolean): StatusReport => ({
    vaultPath: "/v",
    sessions: [{ ...session, costMayBeOvercounted }],
    invalidNotes: [],
    openDecisions: 0,
    costUsd: 1,
    maxBudgetUsd: 5,
    summaryCostUsd: 0,
    summaryBudgetUsd: 0.25,
  });

  it("warns that spend may be overcounted for resumed sessions", () => {
    expect(renderStatus(report(true))).toContain(
      "Spend may be overcounted after a restart (api): resumed sessions can recount their saved total",
    );
  });

  it("says nothing otherwise", () => {
    expect(renderStatus(report(false))).not.toContain("overcounted");
  });
});

describe("orc status: summary spend", () => {
  const api = {
    session: "api",
    workstream: "api",
    branch: "orc/api",
    status: "done",
    currentTask: null,
    tasksDone: 1,
    tasksTotal: 1,
    checks: [],
    costUsd: 2,
    agentSession: null,
    costMayBeOvercounted: false,
    updated: "2026-10-22 10:00",
  } as const;

  it("shows the summary cost on its own line and keeps it out of the run spend", async () => {
    const dir = tmp();
    await writeFile(join(dir, "orc.config.json"), '{"maxBudgetUsd": 10}');
    const paths = vaultPaths(join(dir, "vault"));
    await writeSessionState(paths, api);
    await writeSessionState(paths, {
      ...api,
      session: "summarize",
      workstream: "summarize",
      branch: "none",
      tasksDone: 0,
      tasksTotal: 0,
      costUsd: 0.1,
    });
    const io = captureIO(dir);

    expect(await main(["status"], io)).toBe(0);

    expect(io.out()).toContain("Spend: $2.00 of $10.00 run cap (20.0%)");
    expect(io.out()).toContain(
      "Summary: $0.10 so far, capped at $0.25 per call, separate from the run cap",
    );
    expect(io.out()).toMatch(/summarize\s+done/);
  });

  it("has no summary line before the first summary", () => {
    const report: StatusReport = {
      vaultPath: "/v",
      sessions: [api],
      invalidNotes: [],
      openDecisions: 0,
      costUsd: 2,
      maxBudgetUsd: 10,
      summaryCostUsd: 0,
      summaryBudgetUsd: 0.25,
    };
    expect(renderStatus(report)).not.toContain("Summary:");
  });
});
