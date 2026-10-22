import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENTS_MD_TEXT,
  type App,
  CONTRACT_TEXT,
  escalateReply,
  fixReply,
  MARKER_CHECK,
  RoutedAdapter,
  reloadPlan,
  setupApp,
  tasks,
  testConfig,
  writeMarker,
} from "../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import type { AgentTurnRequest } from "../agents/adapter.js";
import type { OrcConfig } from "../config/types.js";
import { listCheckpoints } from "../git/checkpoints.js";
import { gitOutput } from "../git/git.js";
import { readDecisions } from "../vault/decisions.js";
import { parseLogLine } from "../vault/log.js";
import { readSessionNotes, type SessionState, writeSessionState } from "../vault/session-note.js";
import { type RunDriverOptions, type RunResult, runDriver } from "./run.js";

const tmp = useTmpDir("orc-driver-");
const DRIVER_SYSTEM = "You are the driver.";

interface RunOverrides {
  readonly config?: OrcConfig;
  readonly signal?: AbortSignal;
  readonly only?: readonly string[];
}

async function run(
  app: App,
  adapter: RoutedAdapter,
  overrides: RunOverrides = {},
): Promise<RunResult> {
  const options: RunDriverOptions = {
    adapter,
    config: overrides.config ?? testConfig(),
    vault: app.vault,
    repo: app.repo,
    plan: await reloadPlan(app),
    driverSystemPrompt: DRIVER_SYSTEM,
    env: app.env,
    now: () => localTime(),
    only: overrides.only,
    signal: overrides.signal,
  };
  return runDriver(options);
}

async function note(app: App, name: string): Promise<SessionState> {
  const found = (await readSessionNotes(app.vault)).find((n) => n.name === name);
  if (found === undefined || !found.result.ok) {
    throw new Error(`no valid session note for ${name}`);
  }
  return found.result.state;
}

async function logLines(app: App): Promise<string[]> {
  const text = await readFile(app.vault.log, "utf8");
  return text.split("\n").filter((line) => line.startsWith("["));
}

async function workstreamText(app: App, name: string): Promise<string> {
  return readFile(join(app.vault.planDir, "workstreams", `${name}.md`), "utf8");
}

const ok = (text: string, costUsd = 0.1) => ({ text, costUsd });

describe("runDriver: the happy path", () => {
  it("runs every task with no model call between them when checks pass", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route", "Add tests") });
    const adapter = new RoutedAdapter({ api: [ok("did T1", 0.1), ok("did T2", 0.2)] }, writeMarker);

    const result = await run(app, adapter);

    expect(result.sessions).toEqual([
      { session: "api", end: "done", reason: null, tasksDone: 2, tasksTotal: 2, costUsd: 0.3 },
    ]);
    // Two coding turns and nothing else: no driver call was needed.
    const fake = adapter.route("api");
    expect(fake.requests).toHaveLength(2);
    expect(fake.remaining).toBe(0);

    const [first, second] = fake.requests;
    expect(first).toMatchObject({
      access: "edit",
      model: "claude-sonnet-5-5",
      allowedCommands: [MARKER_CHECK.command],
      projectRoot: app.repo.root,
      maxBudgetUsd: 20,
    });
    expect(first?.cwd).toMatch(/app-orc-worktrees\/api$/);
    expect(first?.resumeSessionId).toBeUndefined();
    expect(first?.prompt).toContain(AGENTS_MD_TEXT);
    expect(first?.prompt).toContain(CONTRACT_TEXT);
    expect(first?.prompt).toContain("T1");
    expect(first?.prompt).toContain("Add route");

    expect(second?.resumeSessionId).toBe("fake-session-1");
    expect(second?.prompt).toContain("T1 passed all checks");
    expect(second?.prompt).toContain("Add tests");
    expect(second?.prompt.length).toBeLessThan((first?.prompt.length ?? 0) / 2);
  });

  it("checkpoints before each task, commits after it, and ticks the plan", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route", "Add tests") });
    let turn = 0;
    await run(
      app,
      new RoutedAdapter({ api: [ok("a"), ok("b")] }, async (request) => {
        turn += 1;
        await writeFile(join(request.cwd, `turn-${turn}.txt`), "x\n");
        await writeMarker(request);
      }),
    );

    expect((await listCheckpoints(app.repo, "api")).map((cp) => cp.id)).toEqual([
      "api/T1",
      "api/T2",
    ]);
    const subjects = await gitOutput(["log", "--format=%s", "orc/api"], {
      cwd: app.root,
      env: app.env,
    });
    expect(subjects.split("\n").slice(0, 2)).toEqual([
      "orc(api): T2 Add tests",
      "orc(api): T1 Add route",
    ]);
    const text = await workstreamText(app, "api");
    expect(text).toContain("- [x] T1: Add route");
    expect(text).toContain("- [x] T2: Add tests");
  });

  it("records state, cost and LOG lines in the main vault", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    await run(app, new RoutedAdapter({ api: [ok("did it", 0.25)] }, writeMarker));

    expect(await note(app, "api")).toMatchObject({
      status: "done",
      currentTask: null,
      tasksDone: 1,
      tasksTotal: 1,
      costUsd: 0.25,
      agentSession: "fake-session-1",
      costMayBeOvercounted: false,
      checks: [{ name: "marker", status: "pass" }],
    });
    const log = await logLines(app);
    expect(log.every((line) => parseLogLine(line) !== null)).toBe(true);
    expect(log.some((line) => line.includes("[api] checkpoint api/T1 before T1"))).toBe(true);
    expect(log.some((line) => line.includes("[api] T1 turn 1: success, checks pass"))).toBe(true);
    expect(log.some((line) => /\[api\] T1 done: Add route \(commit [0-9a-f]{7}\)/.test(line))).toBe(
      true,
    );
    expect(log.some((line) => line.includes("[orc] run finished: api done"))).toBe(true);
    const progress = await readFile(join(app.vault.sessionsDir, "api.md"), "utf8");
    expect(progress).toMatch(/## Progress\n- \[2026-10-21 22:00\] T1 done: Add route/);
  });
});

describe("runDriver: failed checks", () => {
  it("asks the small driver model for a fix prompt, then sends it with the raw output", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter(
      {
        api: [
          ok("first try", 0.1),
          ok(fixReply("The marker file is missing. Create ok.txt."), 0.01),
          ok("fixed", 0.1),
        ],
      },
      (request) => (request.prompt.includes("Check output:") ? writeMarker(request) : undefined),
    );

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({ end: "done", costUsd: 0.21 });
    const [coder, driver, fix] = adapter.route("api").requests;
    expect(driver).toMatchObject({
      model: "claude-haiku-5-5",
      access: "read-only",
      systemPrompt: DRIVER_SYSTEM,
      resumeSessionId: undefined,
    });
    expect(driver?.prompt).toContain("Failed checks");
    expect(driver?.prompt).toContain("test -f ok.txt");
    expect(driver?.prompt).toContain("first try"); // the agent's last summary
    expect(driver?.prompt).toContain(AGENTS_MD_TEXT);
    expect(driver?.prompt).toContain(CONTRACT_TEXT);
    expect(driver?.prompt).toContain("[api] checkpoint api/T1");
    // The fix goes back to the same coding conversation.
    expect(fix?.resumeSessionId).toBe(coder ? "fake-session-1" : undefined);
    expect(fix?.model).toBe("claude-sonnet-5-5");
    expect(fix?.prompt).toContain("Create ok.txt.");
    expect(fix?.prompt).toContain("Check output:");
    expect(fix?.prompt).toContain("marker");
    const log = await logLines(app);
    expect(log.some((line) => line.includes("T1 turn 1: success, checks fail: marker"))).toBe(true);
    expect(log.some((line) => line.includes("T1 turn 2: success, checks pass"))).toBe(true);
  });

  it("escalates and pauses once the retry cap is reached, while other sessions finish", async () => {
    const app = await setupApp(tmp(), {
      api: tasks("Add route", "Add tests"),
      web: tasks("Add page"),
    });
    const adapter = new RoutedAdapter(
      {
        api: [ok("try 1"), ok(fixReply("Create ok.txt.")), ok("try 2")],
        web: [ok("page")],
      },
      (request, workstream) => (workstream === "web" ? writeMarker(request) : undefined),
    );

    const result = await run(app, adapter, { config: testConfig({ retries: { maxPerTask: 1 } }) });

    const api = result.sessions.find((s) => s.session === "api");
    const web = result.sessions.find((s) => s.session === "web");
    expect(api).toMatchObject({ end: "paused", tasksDone: 0 });
    expect(api?.reason).toContain("T1 still failing after 1 fix attempt (checks failed: marker)");
    expect(web).toMatchObject({ end: "done", tasksDone: 1 });

    const decisions = await readDecisions(app.vault);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      status: "open",
      session: "api",
      defaultTaken: null,
      reversible: false,
    });
    expect(decisions[0]?.question).toContain("T1 still failing after 1 fix attempt");
    expect(await note(app, "api")).toMatchObject({ status: "paused", currentTask: "T1 Add route" });
    expect(await note(app, "web")).toMatchObject({ status: "done" });
    // The retry cap held: exactly coder, driver, coder.
    expect(adapter.route("api").requests).toHaveLength(3);
    expect(adapter.route("api").remaining).toBe(0);
  });

  it("with a retry cap of 0, escalates on the first failure without calling the driver", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({ api: [ok("nope")] });

    const result = await run(app, adapter, { config: testConfig({ retries: { maxPerTask: 0 } }) });

    expect(result.sessions[0]).toMatchObject({ end: "paused" });
    expect(adapter.route("api").requests).toHaveLength(1);
    expect(await readDecisions(app.vault)).toHaveLength(1);
  });

  it("takes a reversible default from the driver, records it and carries on", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter(
      {
        api: [
          ok("try"),
          ok(escalateReply("Use zod or valibot for validation?", "Use zod.", true)),
          ok("used zod"),
        ],
      },
      (request) => (request.prompt.includes("Decision for now") ? writeMarker(request) : undefined),
    );

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({ end: "done" });
    const [decision] = await readDecisions(app.vault);
    expect(decision).toMatchObject({
      id: "D-001",
      status: "open",
      defaultTaken: "Use zod.",
      reversible: true,
    });
    const fix = adapter.route("api").requests[2];
    expect(fix?.prompt).toContain("Open question (D-001): Use zod or valibot for validation?");
    expect(fix?.prompt).toContain("Decision for now: Use zod.");
  });

  it("pauses when the driver escalates without a safe default", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({
      api: [ok("try"), ok(escalateReply("Which payment provider?", null, false))],
    });

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({
      end: "paused",
      reason: "D-001: Which payment provider?",
    });
    expect(adapter.route("api").requests).toHaveLength(2);
  });

  it("repairs an unusable driver reply in the same driver session", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter(
      {
        api: [
          ok("try"),
          { text: "Looks like a lint problem to me." },
          ok(fixReply("Create ok.txt.")),
          ok("fixed"),
        ],
      },
      (request) => (request.prompt.includes("Check output:") ? writeMarker(request) : undefined),
    );

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({ end: "done" });
    const [, bad, repair] = adapter.route("api").requests;
    expect(repair?.prompt).toContain("orc could not use your last reply");
    expect(repair?.resumeSessionId).toBe("fake-session-2");
    expect(repair?.model).toBe("claude-haiku-5-5");
    expect(bad?.resumeSessionId).toBeUndefined();
  });

  it("falls back to a plain fix prompt when the driver never gives a usable reply", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter(
      {
        api: [ok("try"), ok("nonsense"), ok("still nonsense"), ok("fixed")],
      },
      (request) => (request.prompt.includes("Check output:") ? writeMarker(request) : undefined),
    );

    const result = await run(app, adapter, { config: testConfig({ retries: { maxPerTask: 1 } }) });

    expect(result.sessions[0]).toMatchObject({ end: "done" });
    expect(adapter.route("api").requests[3]?.prompt).toContain("The checks failed after T1");
    expect((await logLines(app)).some((l) => l.includes("driver gave no usable reply"))).toBe(true);
  });
});

describe("runDriver: turns that do not succeed", () => {
  it("asks the agent to continue after max_turns, counted against the retry cap", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter(
      { api: [{ text: "", outcome: "max_turns", costUsd: 0.5 }, ok("finished")] },
      writeMarker,
    );

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({ end: "done", costUsd: 0.6 });
    const second = adapter.route("api").requests[1];
    expect(second?.prompt).toContain("ended early (max_turns)");
    expect(second?.resumeSessionId).toBe("fake-session-1");
  });

  it("pauses with a decision when the agent refuses", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({
      api: [{ text: "", outcome: "refused", errors: ["cannot help with that"] }],
    });

    const result = await run(app, adapter);

    expect(result.sessions[0]).toMatchObject({ end: "paused", reason: "the agent refused T1" });
    const [decision] = await readDecisions(app.vault);
    expect(decision?.question).toContain("cannot help with that");
  });

  it("turns a crashing session into a pause without stopping the others", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route"), web: tasks("Add page") });
    const adapter = new RoutedAdapter(
      { api: [], web: [ok("page")] }, // api's script is empty: its first turn throws
      writeMarker,
    );

    const result = await run(app, adapter);

    expect(result.sessions.find((s) => s.session === "api")).toMatchObject({
      end: "paused",
      reason: expect.stringContaining("crashed: fake adapter: no scripted turn left"),
    });
    expect(result.sessions.find((s) => s.session === "web")).toMatchObject({ end: "done" });
    expect(await note(app, "api")).toMatchObject({ status: "paused" });
  });
});

describe("runDriver: budget cap", () => {
  it("pauses before the next call once the run cap is spent, then resumes after a raise", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route", "Add tests") });
    const first = new RoutedAdapter({ api: [ok("one", 0.3)] }, writeMarker);

    const paused = await run(app, first, { config: testConfig({ maxBudgetUsd: 0.25 }) });

    expect(first.route("api").requests[0]?.maxBudgetUsd).toBe(0.25);
    expect(paused.sessions[0]).toMatchObject({ end: "paused", tasksDone: 1 });
    expect(paused.sessions[0]?.reason).toContain("run cap of $0.25 reached");
    const [decision] = await readDecisions(app.vault);
    expect(decision?.question).toContain("Raise maxBudgetUsd");
    expect(first.route("api").requests).toHaveLength(1);

    // Second run: the saved spend counts, T1 is skipped, the agent conversation is resumed.
    const second = new RoutedAdapter({ api: [ok("two", 0.2)] }, writeMarker);
    const resumed = await run(app, second, { config: testConfig({ maxBudgetUsd: 1 }) });

    expect(resumed.sessions[0]).toMatchObject({ end: "done", tasksDone: 2, costUsd: 0.5 });
    const request = second.route("api").requests[0];
    expect(request?.maxBudgetUsd).toBeCloseTo(0.7, 6);
    expect(request?.resumeSessionId).toBe("fake-session-1");
    expect(request?.prompt).toContain("orc was restarted");
    expect(request?.prompt).toContain("Add tests");
    expect(await note(app, "api")).toMatchObject({ costMayBeOvercounted: true });
    expect((await listCheckpoints(app.repo, "api")).map((cp) => cp.id)).toEqual([
      "api/T1",
      "api/T2",
    ]);
  });

  it("pauses when a turn itself hits the cap", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({
      api: [{ text: "", outcome: "max_budget", costUsd: 0.05 }],
    });

    const result = await run(app, adapter, { config: testConfig({ maxBudgetUsd: 0.05 }) });

    expect(result.sessions[0]).toMatchObject({ end: "paused", costUsd: 0.05 });
    expect(result.sessions[0]?.reason).toContain("run cap of $0.05 reached");
    expect((await readDecisions(app.vault))[0]?.session).toBe("api");
  });

  it("counts driver calls against the same cap", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({
      api: [ok("try", 0.1), ok(fixReply("Create ok.txt."), 0.2)],
    });

    const result = await run(app, adapter, { config: testConfig({ maxBudgetUsd: 0.25 }) });

    // 0.1 + 0.2 = 0.3 >= 0.25: the fix turn never starts.
    expect(result.sessions[0]).toMatchObject({ end: "paused", costUsd: 0.3 });
    expect(adapter.route("api").requests).toHaveLength(2);
    expect(adapter.route("api").requests[1]?.maxBudgetUsd).toBeCloseTo(0.15, 6);
  });
});

describe("runDriver: dependencies between workstreams", () => {
  it("starts a task only after the tasks it needs are done", async () => {
    const app = await setupApp(tmp(), {
      api: tasks("Add route"),
      web: "- [ ] T1: Add page (needs: api/T1)",
    });
    const adapter = new RoutedAdapter({ api: [ok("route")], web: [ok("page")] }, writeMarker);

    const result = await run(app, adapter);

    expect(result.sessions.map((s) => s.end)).toEqual(["done", "done"]);
    const log = await logLines(app);
    const apiDone = log.findIndex((line) => line.includes("[api] T1 done"));
    const webStart = log.findIndex((line) => line.includes("[web] checkpoint web/T1"));
    expect(apiDone).toBeGreaterThan(-1);
    expect(webStart).toBeGreaterThan(apiDone);
  });

  it("pauses a task whose dependency's workstream stopped without finishing it", async () => {
    const app = await setupApp(tmp(), {
      api: tasks("Add route"),
      web: "- [ ] T1: Add page (needs: api/T1)",
    });
    const adapter = new RoutedAdapter({ api: [ok("nope")], web: [] });

    const result = await run(app, adapter, { config: testConfig({ retries: { maxPerTask: 0 } }) });

    const web = result.sessions.find((s) => s.session === "web");
    expect(web).toMatchObject({ end: "paused" });
    expect(web?.reason).toContain("T1 needs api/T1, but that workstream stopped");
    expect(adapter.route("web").requests).toHaveLength(0);
    expect((await readDecisions(app.vault)).map((d) => d.session).sort()).toEqual(["api", "web"]);
  });

  it("skips tasks already ticked in the plan, and counts them as done for dependents", async () => {
    const app = await setupApp(tmp(), {
      api: "- [x] T1: Add route\n- [ ] T2: Add tests",
      web: "- [ ] T1: Add page (needs: api/T1)",
    });
    const adapter = new RoutedAdapter({ api: [ok("tests")], web: [ok("page")] }, writeMarker);

    const result = await run(app, adapter);

    expect(result.sessions.map((s) => [s.session, s.end, s.tasksDone])).toEqual([
      ["api", "done", 2],
      ["web", "done", 1],
    ]);
    expect(adapter.route("api").requests[0]?.prompt).toContain("Add tests");
  });
});

describe("runDriver: concurrency and stopping", () => {
  it("writes whole LOG lines when many sessions append at once", async () => {
    const names = ["alpha", "beta", "gamma", "delta"];
    const app = await setupApp(
      tmp(),
      Object.fromEntries(names.map((name) => [name, tasks("One", "Two", "Three")])),
    );
    const adapter = new RoutedAdapter(
      Object.fromEntries(names.map((name) => [name, [ok("1"), ok("2"), ok("3")]])),
      writeMarker,
    );

    const result = await run(app, adapter);

    expect(result.sessions.every((s) => s.end === "done")).toBe(true);
    const text = await readFile(app.vault.log, "utf8");
    const lines = text.split("\n").filter((line) => line.startsWith("["));
    expect(lines.length).toBeGreaterThan(names.length * 9);
    expect(lines.every((line) => parseLogLine(line) !== null)).toBe(true);
    for (const name of names) {
      expect(lines.filter((line) => line.includes(`][${name}] `)).length).toBeGreaterThanOrEqual(9);
    }
  });

  it("stops cleanly when aborted before starting", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({ api: [ok("never")] });
    const controller = new AbortController();
    controller.abort();

    const result = await run(app, adapter, { signal: controller.signal });

    expect(result.sessions[0]).toMatchObject({ end: "stopped", tasksDone: 0 });
    expect(adapter.route("api").requests).toHaveLength(0);
    expect(await readDecisions(app.vault)).toEqual([]);
    expect(await note(app, "api")).toMatchObject({ status: "stopped" });
  });

  it("treats an abort during a turn as a stop, not a failure", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route", "Add tests") });
    const controller = new AbortController();
    const adapter = new RoutedAdapter({ api: [ok("one"), ok("two")] }, (request) => {
      if (request.prompt.includes("Add tests")) {
        controller.abort();
      }
      return writeMarker(request);
    });

    const result = await run(app, adapter, { signal: controller.signal });

    expect(result.sessions[0]).toMatchObject({ end: "stopped", tasksDone: 1 });
    expect(await readDecisions(app.vault)).toEqual([]);
    expect(await workstreamText(app, "api")).toContain("- [x] T1");
    expect(await workstreamText(app, "api")).toContain("- [ ] T2");
  });

  it("runs only the selected workstreams", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route"), web: tasks("Add page") });
    const adapter = new RoutedAdapter({ api: [ok("route")], web: [] }, writeMarker);

    const result = await run(app, adapter, { only: ["api"] });

    expect(result.sessions.map((s) => s.session)).toEqual(["api"]);
    expect(adapter.route("web").requests).toHaveLength(0);
  });

  it("rejects an unknown workstream before doing anything", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    await expect(
      run(app, new RoutedAdapter({ api: [] }), { only: ["nope"] }),
    ).rejects.toMatchObject({ code: "USAGE" });
  });

  it("refuses to run over an unreadable session note", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    await writeFile(join(app.vault.sessionsDir, "api.md"), "---\nstatus: wat\n---\n");

    await expect(run(app, new RoutedAdapter({ api: [] }))).rejects.toMatchObject({
      code: "SESSION_NOTE_INVALID",
    });
  });
});

describe("runDriver: requests never leak past the contract", () => {
  it("never gives the coding agent more than edit access and the check commands", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    const adapter = new RoutedAdapter({ api: [ok("x")] }, writeMarker);
    await run(app, adapter);
    const requests: readonly AgentTurnRequest[] = adapter.route("api").requests;
    for (const request of requests) {
      expect(request.allowedCommands).toEqual([MARKER_CHECK.command]);
      expect(request.signal).toBeUndefined();
    }
  });
});

describe("runDriver: summary spend", () => {
  it("does not count the summarize session toward the run cap", async () => {
    const app = await setupApp(tmp(), { api: tasks("Add route") });
    await writeSessionState(app.vault, {
      session: "summarize",
      workstream: "summarize",
      branch: "none",
      status: "done",
      currentTask: null,
      tasksDone: 0,
      tasksTotal: 0,
      checks: [],
      costUsd: 500,
      agentSession: null,
      costMayBeOvercounted: false,
      updated: "2026-10-22 10:00",
    });
    const adapter = new RoutedAdapter({ api: [ok("did T1")] }, writeMarker);

    const result = await run(app, adapter, { config: testConfig({ maxBudgetUsd: 5 }) });

    expect(result.sessions[0]?.end).toBe("done");
    expect(result.spentUsd).toBe(0.1);
  });
});
