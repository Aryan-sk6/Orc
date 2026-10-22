import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type App, setupApp, tasks, testConfig } from "../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import { FakeAgentAdapter, type FakeTurn } from "../agents/fake.js";
import type { OrcConfig } from "../config/types.js";
import { appendDecision } from "../vault/decisions.js";
import { parseFrontmatter } from "../vault/frontmatter.js";
import { appendLog } from "../vault/log.js";
import {
  appendToSessionSection,
  readSessionNotes,
  type SessionState,
  writeSessionState,
} from "../vault/session-note.js";
import { loadSummaryPrompt, SUMMARY_HEADINGS, validateSummary } from "./prompts.js";
import { runSummary, type SummarizeResult } from "./summarize.js";

const tmp = useTmpDir("orc-summarize-");

const REPLY = [
  "## What was built",
  "The api workstream delivered the routes.",
  "",
  "## What went wrong",
  "Nothing notable.",
  "",
  "## Decisions for you",
  "D-001: pick a database.",
  "",
  "## Next steps",
  "1. Answer D-001, then run `orc run`.",
].join("\n");

function state(overrides: Partial<SessionState>): SessionState {
  return {
    session: "api",
    workstream: "api",
    branch: "orc/api",
    status: "done",
    currentTask: null,
    tasksDone: 2,
    tasksTotal: 2,
    checks: [{ name: "test", status: "pass" }],
    costUsd: 1.5,
    agentSession: null,
    costMayBeOvercounted: false,
    updated: "2026-10-22 12:00",
    ...overrides,
  };
}

async function appWithSessions(): Promise<App> {
  const app = await setupApp(tmp(), { api: tasks("A", "B") });
  await writeSessionState(app.vault, state({}));
  await appendToSessionSection(app.vault, "api", "Problems", "T2: lint failed once", localTime());
  await writeSessionState(
    app.vault,
    state({
      session: "web",
      workstream: "web",
      branch: "orc/web",
      status: "paused",
      tasksDone: 0,
      checks: [],
      costUsd: 0.5,
    }),
  );
  await appendDecision(app.vault, {
    session: "web",
    question: "Which database?",
    defaultTaken: null,
    reversible: false,
    now: localTime(),
  });
  await appendLog(app.vault, { session: "api", did: "T1 done: A", now: localTime() });
  return app;
}

async function summarize(
  app: App,
  adapter: FakeAgentAdapter | null,
  config: OrcConfig = testConfig(),
): Promise<SummarizeResult> {
  return runSummary({
    adapter,
    config,
    vault: app.vault,
    rootDir: app.repo.root,
    systemPrompt: "You write the report.",
    now: () => localTime(),
  });
}

const turn = (text: string, extra: Partial<FakeTurn> = {}): FakeTurn => ({
  text,
  costUsd: 0.02,
  ...extra,
});

describe("runSummary", () => {
  it("writes the model's narrative above the deterministic tables", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({
      turns: [turn(REPLY, { expect: "Session note: api" })],
    });

    const result = await summarize(app, adapter);

    expect(result).toMatchObject({ narrative: true, reason: null, costUsd: 0.02 });
    const report = await readFile(app.vault.report, "utf8");
    expect(parseFrontmatter(report).data).toMatchObject({
      tags: "report",
      narrative: true,
      summaryCostUsd: 0.02,
    });
    expect(report.indexOf("## What was built")).toBeLessThan(report.indexOf("## Sessions"));
    expect(report).toContain("| api | done | 2/2 | test pass | $1.50 |");
    expect(report).toContain("| web | paused | 0/2 | - | $0.50 |");
    expect(report).toContain("**D-001** (web,");
    expect(report).toContain("$2.00 of $20.00 run cap");
    expect(await readFile(app.vault.log, "utf8")).toContain(
      "[orc] summarize: wrote report.md (with narrative, ~$0.02)",
    );
  });

  it("asks the small driver model, read-only, with the fixed summary cap", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({ turns: [turn(REPLY)] });

    await summarize(app, adapter, testConfig({ maxBudgetUsd: 5, summaryBudgetUsd: 0.5 }));

    const request = adapter.requests[0];
    expect(request).toMatchObject({
      model: testConfig().driver.model,
      access: "read-only",
      systemPrompt: "You write the report.",
      cwd: app.repo.root,
      maxBudgetUsd: 0.5,
    });
    expect(request?.prompt).toContain("T2: lint failed once");
    expect(request?.prompt).toContain("T1 done: A");
    expect(request?.prompt).toContain("Which database?");
  });

  it("repairs an unusable reply in the same conversation", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({
      turns: [
        turn("Here is a summary without sections."),
        turn(REPLY, { expect: "missing the section" }),
      ],
    });

    const result = await summarize(app, adapter);

    expect(result.narrative).toBe(true);
    expect(result.costUsd).toBe(0.04);
    expect(adapter.requests[1]?.resumeSessionId).toBe(
      adapter.requests[0] === undefined ? "" : "fake-session-1",
    );
  });

  it("still writes the report, with the reason, when replies stay unusable", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({ turns: [turn("no"), turn("still no"), turn("nope")] });

    const result = await summarize(app, adapter, testConfig({ retries: { maxPerTask: 2 } }));

    expect(result.narrative).toBe(false);
    expect(result.reason).toContain("unusable");
    const report = await readFile(app.vault.report, "utf8");
    expect(report).toContain("_No narrative:");
    expect(report).toContain("## Sessions");
  });

  it("writes only the tables without an adapter", async () => {
    const app = await appWithSessions();

    const result = await summarize(app, null);

    expect(result).toMatchObject({ narrative: false, costUsd: 0 });
    expect(await readFile(app.vault.report, "utf8")).toContain("_No narrative: facts only");
  });

  it("is not drawn from the run budget: it still runs when the run cap is spent", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({ turns: [turn(REPLY)] });

    const result = await summarize(app, adapter, testConfig({ maxBudgetUsd: 2 }));

    expect(result.narrative).toBe(true);
    expect(adapter.requests[0]?.maxBudgetUsd).toBe(0.25);
  });

  it("stops repairing when the fixed summary cap is used up", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({
      turns: [turn("no", { costUsd: 0.2 }), turn("no", { costUsd: 0.1 }), turn(REPLY)],
    });

    const result = await summarize(app, adapter);

    expect(result.narrative).toBe(false);
    expect(result.reason).toContain("summary cap of $0.25");
    expect(adapter.requests.map((r) => Math.round((r.maxBudgetUsd ?? 0) * 1e4) / 1e4)).toEqual([
      0.25, 0.05,
    ]);
  });

  it("records its spend in the summarize session note, accumulating, outside the run total", async () => {
    const app = await appWithSessions();

    await summarize(app, new FakeAgentAdapter({ turns: [turn(REPLY, { costUsd: 0.04 })] }));
    await summarize(app, new FakeAgentAdapter({ turns: [turn(REPLY, { costUsd: 0.03 })] }));

    const note = (await readSessionNotes(app.vault)).find((n) => n.name === "summarize");
    expect(note?.result.ok && note.result.state.costUsd).toBe(0.07);
    const report = await readFile(app.vault.report, "utf8");
    expect(report).toContain("$2.00 of $20.00 run cap");
    expect(report).toContain("Summary calls: $0.07 so far, capped at $0.25 per call");
    expect(report).toContain("| summarize | done |");
  });

  it("makes no note for a facts-only report", async () => {
    const app = await appWithSessions();

    await summarize(app, null);

    expect((await readSessionNotes(app.vault)).some((n) => n.name === "summarize")).toBe(false);
  });

  it("reports a failed model call instead of failing the command", async () => {
    const app = await appWithSessions();
    const adapter = new FakeAgentAdapter({
      turns: [{ text: "", outcome: "error", errors: ["overloaded"], costUsd: 0 }],
    });

    const result = await summarize(app, adapter);

    expect(result.reason).toContain("ended with error (overloaded)");
    expect(await readFile(app.vault.report, "utf8")).toContain("_No narrative:");
  });

  it("works on an empty vault", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });

    await summarize(app, null);

    expect(await readFile(app.vault.report, "utf8")).toContain("No sessions have run yet.");
  });
});

describe("validateSummary", () => {
  it("accepts the four sections and unwraps one code fence", () => {
    expect(validateSummary(REPLY)).toEqual({ ok: true, value: REPLY });
    expect(validateSummary(`\`\`\`markdown\n${REPLY}\n\`\`\``)).toEqual({ ok: true, value: REPLY });
  });

  it("names missing, misordered and extra sections", () => {
    const missing = validateSummary("## What was built\nx\n## Next steps\ny");
    expect(!missing.ok && missing.issues).toEqual([
      'missing the section "## What went wrong"',
      'missing the section "## Decisions for you"',
    ]);

    const swapped = validateSummary(
      "## What went wrong\na\n## What was built\nb\n## Decisions for you\nc\n## Next steps\nd",
    );
    expect(!swapped.ok && swapped.issues).toEqual(['"## What went wrong" is out of order']);

    const extra = validateSummary(`${REPLY}\n\n## Bonus\nz`);
    expect(!extra.ok && extra.issues).toEqual(['unexpected sections: "## Bonus"']);
  });
});

describe("kit/prompts/summary.md", () => {
  it("asks for exactly the sections the validator checks", async () => {
    const prompt = await loadSummaryPrompt();
    for (const heading of SUMMARY_HEADINGS) {
      expect(prompt).toContain(`## ${heading}`);
    }
  });
});
