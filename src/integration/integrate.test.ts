import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type App, reloadPlan, setupApp, tasks, testConfig } from "../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import type { OrcConfig } from "../config/types.js";
import { commitAll } from "../git/checkpoints.js";
import { gitOutput } from "../git/git.js";
import { defaultWorktreesDir, ensureWorktree } from "../git/worktrees.js";
import { readDecisions } from "../vault/decisions.js";
import { markTaskDone } from "../vault/plan.js";
import { readSessionNotes, type SessionState } from "../vault/session-note.js";
import { type IntegrationResult, runIntegration } from "./integrate.js";

const tmp = useTmpDir("orc-integrate-");

/** Plays a finished workstream: its branch holds `files` and every task is ticked. */
async function finish(
  app: App,
  name: string,
  files: Readonly<Record<string, string>>,
  taskIds: readonly string[] = ["T1"],
): Promise<void> {
  const { worktree } = await ensureWorktree(app, {
    name,
    worktreesDir: defaultWorktreesDir(app.repo.root),
  });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(worktree.path, file)), { recursive: true });
    await writeFile(join(worktree.path, file), content);
  }
  await commitAll({ path: worktree.path, env: app.env }, `orc(${name}): work`);
  for (const id of taskIds) {
    await markTaskDone(app.vault, name, id);
  }
}

function check(command: string, name = "files"): OrcConfig {
  return testConfig({ checks: [{ name, command, timeoutMs: 20_000 }] });
}

async function integrate(
  app: App,
  config: OrcConfig,
  signal?: AbortSignal,
): Promise<IntegrationResult> {
  return runIntegration({
    config,
    vault: app.vault,
    repo: app.repo,
    plan: await reloadPlan(app),
    milestone: "m1",
    env: app.env,
    now: () => localTime(),
    signal,
  });
}

async function note(app: App): Promise<SessionState> {
  const found = (await readSessionNotes(app.vault)).find((n) => n.name === "integration");
  if (found === undefined || !found.result.ok) {
    throw new Error("no valid integration note");
  }
  return found.result.state;
}

const kinds = (result: IntegrationResult): string[] =>
  result.merges.map((m) => `${m.workstream}:${m.status.kind}`);

describe("runIntegration", () => {
  it("merges finished workstreams, runs the checks on the result and records a done session", async () => {
    const app = await setupApp(tmp(), { api: tasks("A"), web: tasks("B") });
    await finish(app, "api", { "src/api/a.txt": "a\n" });
    await finish(app, "web", { "src/web/b.txt": "b\n" });

    const result = await integrate(app, check("test -f src/api/a.txt && test -f src/web/b.txt"));

    expect(result.end).toBe("done");
    expect(kinds(result)).toEqual(["api:merged", "web:merged"]);
    expect(result.branch).toBe("orc-integration/m1");
    expect(result.checks?.map((c) => c.status)).toEqual(["pass"]);
    expect(
      await gitOutput(["branch", "--list", "orc-integration/m1"], {
        cwd: app.root,
        env: app.env,
      }),
    ).toContain("m1");
    expect(await readDecisions(app.vault)).toEqual([]);
    expect(await note(app)).toMatchObject({
      status: "done",
      tasksDone: 2,
      tasksTotal: 2,
      branch: "orc-integration/m1",
      checks: [{ name: "files", status: "pass" }],
    });
    expect(await readFile(app.vault.log, "utf8")).toContain("[integration]");
  });

  it("is idempotent: a second run finds everything already merged", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });
    await finish(app, "api", { "a.txt": "a\n" });
    await integrate(app, check("test -f a.txt"));

    const again = await integrate(app, check("test -f a.txt"));

    expect(again.end).toBe("done");
    expect(kinds(again)).toEqual(["api:already-merged"]);
  });

  it("escalates a conflict, leaves it unmerged and still merges the others", async () => {
    const app = await setupApp(tmp(), { api: tasks("A"), db: tasks("C"), web: tasks("B") });
    await finish(app, "api", { "shared.txt": "api\n" });
    await finish(app, "db", { "db.txt": "db\n" });
    await finish(app, "web", { "shared.txt": "web\n" });

    const result = await integrate(app, check("test -f db.txt"));

    expect(kinds(result)).toEqual(["api:merged", "db:merged", "web:conflict"]);
    expect(result.end).toBe("paused");
    expect(result.reason).toContain("web");
    const decisions = await readDecisions(app.vault);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      session: "integration",
      status: "open",
      defaultTaken: null,
    });
    expect(decisions[0]?.question).toContain("shared.txt");
    expect((await note(app)).status).toBe("paused");
    // The conflict was aborted: the integration worktree is clean.
    expect(
      await gitOutput(["status", "--porcelain"], { cwd: result.worktreePath, env: app.env }),
    ).toBe("");
  });

  it("skips unfinished workstreams and those depending on them, without a decision", async () => {
    const app = await setupApp(tmp(), {
      api: `${tasks("A")}\n- [ ] T2: more`,
      db: tasks("C"),
      web: "- [ ] T1: B (needs: api/T1)",
    });
    await finish(app, "api", { "a.txt": "a\n" }, ["T1"]);
    await finish(app, "db", { "db.txt": "db\n" });
    await finish(app, "web", { "w.txt": "w\n" }, []);

    const result = await integrate(app, check("test -f db.txt"));

    expect(kinds(result)).toEqual(["api:skipped", "db:merged", "web:skipped"]);
    const skipped = result.merges.map((m) => (m.status.kind === "skipped" ? m.status.reason : ""));
    expect(skipped[0]).toContain("unfinished (1/2");
    expect(skipped[2]).toContain("unfinished");
    expect(result.end).toBe("paused");
    expect(await readDecisions(app.vault)).toEqual([]);
  });

  it("merges a dependency before the workstream that needs it", async () => {
    const app = await setupApp(tmp(), { alpha: "- [ ] T1: A (needs: zeta/T1)", zeta: tasks("Z") });
    await finish(app, "alpha", { "a.txt": "a\n" });
    await finish(app, "zeta", { "z.txt": "z\n" });

    const result = await integrate(app, check("test -f a.txt && test -f z.txt"));

    expect(kinds(result)).toEqual(["zeta:merged", "alpha:merged"]);
    expect(result.end).toBe("done");
  });

  it("merges workstreams that need each other once all of them are finished", async () => {
    const app = await setupApp(tmp(), {
      alpha: "- [ ] T1: A1 (needs: zeta/T1)\n- [ ] T2: A2",
      zeta: "- [ ] T1: Z1\n- [ ] T2: Z2 (needs: alpha/T2)",
    });
    await finish(app, "alpha", { "a.txt": "a\n" }, ["T1", "T2"]);
    await finish(app, "zeta", { "z.txt": "z\n" }, ["T1", "T2"]);

    const result = await integrate(app, check("test -f a.txt && test -f z.txt"));

    expect(kinds(result).sort()).toEqual(["alpha:merged", "zeta:merged"]);
    expect(result.end).toBe("done");
  });

  it("does not merge a workstream whose mutually dependent mate is unfinished", async () => {
    const app = await setupApp(tmp(), {
      alpha: "- [ ] T1: A1 (needs: zeta/T1)\n- [ ] T2: A2",
      zeta: "- [ ] T1: Z1\n- [ ] T2: Z2 (needs: alpha/T2)",
    });
    await finish(app, "alpha", { "a.txt": "a\n" }, ["T1", "T2"]);
    await finish(app, "zeta", { "z.txt": "z\n" }, ["T1"]);

    const result = await integrate(app, check("true"));

    expect(kinds(result).sort()).toEqual(["alpha:skipped", "zeta:skipped"]);
    expect(result.end).toBe("paused");
    expect(await readDecisions(app.vault)).toHaveLength(0);
  });

  it("escalates when every workstream is finished but nothing could be merged", async () => {
    const app = await setupApp(tmp(), { alpha: tasks("A") });
    await markTaskDone(app.vault, "alpha", "T1");

    const result = await integrate(app, check("true"));

    expect(result.end).toBe("paused");
    expect(await readDecisions(app.vault)).toHaveLength(1);
  });

  it("escalates failing checks with the failing check named", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });
    await finish(app, "api", { "a.txt": "a\n" });

    const result = await integrate(app, check("echo boom && exit 3", "unit"));

    expect(result.end).toBe("paused");
    expect(result.reason).toContain("unit");
    const decisions = await readDecisions(app.vault);
    expect(decisions[0]?.question).toContain("checks failed on orc-integration/m1: unit");
    expect(await readFile(join(app.vault.sessionsDir, "integration.md"), "utf8")).toContain("boom");
    expect((await note(app)).checks).toEqual([{ name: "unit", status: "fail" }]);
  });

  it("runs installCommand in the integration worktree before the checks", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });
    await finish(app, "api", { "a.txt": "a\n" });
    const config = testConfig({
      installCommand: "touch installed.txt",
      checks: [{ name: "installed", command: "test -f installed.txt", timeoutMs: 20_000 }],
    });

    const result = await integrate(app, config);

    expect(result.install?.status).toBe("pass");
    expect(result.end).toBe("done");
  });

  it("pauses with a decision when installCommand fails and runs no checks", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });
    await finish(app, "api", { "a.txt": "a\n" });
    const config = testConfig({
      installCommand: "exit 2",
      checks: [{ name: "never", command: "true", timeoutMs: 20_000 }],
    });

    const result = await integrate(app, config);

    expect(result.end).toBe("paused");
    expect(result.checks).toBeNull();
    expect((await readDecisions(app.vault))[0]?.question).toContain("install command failed");
  });

  it("pauses without checks when nothing is finished", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });

    const result = await integrate(app, check("false"));

    expect(result.end).toBe("paused");
    expect(result.checks).toBeNull();
    expect(kinds(result)).toEqual(["api:skipped"]);
  });

  it("ends stopped when interrupted", async () => {
    const app = await setupApp(tmp(), { api: tasks("A") });
    await finish(app, "api", { "a.txt": "a\n" });
    const controller = new AbortController();
    controller.abort();

    const result = await integrate(app, check("true"), controller.signal);

    expect(result.end).toBe("stopped");
    expect((await note(app)).status).toBe("stopped");
  });
});
