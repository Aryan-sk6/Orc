import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type App,
  RoutedAdapter,
  reloadPlan,
  setupApp,
  tasks,
  testConfig,
} from "../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import type { AgentTurnRequest } from "../agents/adapter.js";
import { OrcError } from "../core/errors.js";
import { runDriver } from "../driver/run.js";
import { git, gitOutput } from "../git/git.js";
import { defaultWorktreesDir } from "../git/worktrees.js";
import { readSessionNotes, type SessionState, writeSessionState } from "../vault/session-note.js";
import { rewindWorkstream } from "./rewind.js";

const tmp = useTmpDir("orc-rewind-");

/** The "agent": every coding turn leaves a file named after the prompt's task (t1.txt, t2.txt, ...). */
async function writeTaskFile(request: AgentTurnRequest): Promise<void> {
  if (request.access !== "edit") {
    return;
  }
  const task = /(?:first task:|Next task,) T(\d+)/.exec(request.prompt)?.[1] ?? "x";
  await writeFile(join(request.cwd, `t${task}.txt`), `task ${task}\n`);
}

/** Runs every workstream to the end (checks always pass), leaving checkpoints and commits. */
async function runAll(app: App, perWorkstream: Readonly<Record<string, number>>): Promise<void> {
  const scripts = Object.fromEntries(
    Object.entries(perWorkstream).map(([name, count]) => [
      name,
      Array.from({ length: count }, (_, i) => ({ text: `did T${i + 1}`, costUsd: 0.1 })),
    ]),
  );
  await runDriver({
    adapter: new RoutedAdapter(scripts, writeTaskFile),
    config: testConfig({ checks: [{ name: "ok", command: "true", timeoutMs: 20_000 }] }),
    vault: app.vault,
    repo: app.repo,
    plan: await reloadPlan(app),
    driverSystemPrompt: "driver",
    env: app.env,
    now: () => localTime(),
  });
}

function rewind(app: App, checkpointId: string, force = false) {
  return rewindWorkstream({
    vault: app.vault,
    repo: app.repo,
    checkpointId,
    force,
    env: app.env,
    now: () => localTime(),
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function note(app: App, name: string): Promise<SessionState> {
  const found = (await readSessionNotes(app.vault)).find((n) => n.name === name);
  if (found === undefined || !found.result.ok) {
    throw new Error(`no valid session note for ${name}`);
  }
  return found.result.state;
}

describe("rewindWorkstream", () => {
  it("resets the worktree, unticks the plan and resets the session note", async () => {
    const app = await setupApp(tmp(), { api: tasks("One", "Two", "Three") });
    await runAll(app, { api: 3 });
    const worktree = join(defaultWorktreesDir(app.root), "api");
    expect((await note(app, "api")).tasksDone).toBe(3);

    const result = await rewind(app, "api/T2");

    expect(result.undoneTasks).toEqual(["T2", "T3"]);
    expect(result.tasksDone).toBe(1);
    expect(result.worktreePath).toContain("api");
    expect(await exists(join(worktree, "t1.txt"))).toBe(true);
    expect(await exists(join(worktree, "t2.txt"))).toBe(false);
    expect(await exists(join(worktree, "t3.txt"))).toBe(false);
    const plan = await readFile(join(app.vault.planDir, "workstreams", "api.md"), "utf8");
    expect(plan).toContain("- [x] T1: One\n- [ ] T2: Two\n- [ ] T3: Three");
    expect(await note(app, "api")).toMatchObject({
      status: "pending",
      currentTask: null,
      tasksDone: 1,
      tasksTotal: 3,
      agentSession: null,
      costUsd: 0.3,
    });
    expect(await readFile(app.vault.log, "utf8")).toContain(
      "[orc] rewound api to api/T2 (backup orc-backup/api/1); unticked T2, T3",
    );
  });

  it("keeps the discarded work under the backup tag", async () => {
    const app = await setupApp(tmp(), { api: tasks("One", "Two") });
    await runAll(app, { api: 2 });

    const { backupTag } = await rewind(app, "api/T2");

    const kept = await gitOutput(["ls-tree", "--name-only", backupTag], {
      cwd: app.root,
      env: app.env,
    });
    expect(kept.split("\n")).toContain("t2.txt");
  });

  it("lets the next run start the rewound task again", async () => {
    const app = await setupApp(tmp(), { api: tasks("One", "Two") });
    await runAll(app, { api: 2 });
    await rewind(app, "api/T2");

    const adapter = new RoutedAdapter({ api: [{ text: "redo T2", costUsd: 0.1 }] }, writeTaskFile);
    const result = await runDriver({
      adapter,
      config: testConfig({ checks: [{ name: "ok", command: "true", timeoutMs: 20_000 }] }),
      vault: app.vault,
      repo: app.repo,
      plan: await reloadPlan(app),
      driverSystemPrompt: "driver",
      env: app.env,
      now: () => localTime(),
    });

    expect(result.sessions[0]).toMatchObject({ end: "done", tasksDone: 2 });
    // A fresh conversation: the first prompt carries the full context again and no resume id.
    const request = adapter.route("api").requests[0];
    expect(request?.resumeSessionId).toBeUndefined();
    expect(request?.prompt).toContain("You are the coding session");
    expect(request?.prompt).toContain("T2");
  });

  it("warns about finished tasks in other workstreams built on the undone ones", async () => {
    const app = await setupApp(tmp(), {
      api: tasks("One", "Two"),
      web: "- [ ] T1: Use the api (needs: api/T2)",
    });
    await runAll(app, { api: 2, web: 1 });

    const result = await rewind(app, "api/T2");

    expect(result.dependentTasks).toEqual(["web/T1"]);
  });

  it("warns when an integration branch already holds the discarded work", async () => {
    const app = await setupApp(tmp(), { api: tasks("One", "Two") });
    await runAll(app, { api: 2 });
    await git(["branch", "orc-integration/m1", "orc/api"], { cwd: app.root, env: app.env });

    const result = await rewind(app, "api/T2");

    expect(result.integrationBranches).toEqual(["orc-integration/m1"]);
  });

  it("refuses while the session is marked running, unless forced", async () => {
    const app = await setupApp(tmp(), { api: tasks("One", "Two") });
    await runAll(app, { api: 2 });
    await writeSessionState(app.vault, { ...(await note(app, "api")), status: "running" });

    const error = await rewind(app, "api/T2").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrcError);
    expect((error as OrcError).code).toBe("REWIND_BLOCKED");

    expect((await rewind(app, "api/T2", true)).undoneTasks).toEqual(["T2"]);
  });

  it("rejects a checkpoint that does not exist", async () => {
    const app = await setupApp(tmp(), { api: tasks("One") });
    await runAll(app, { api: 1 });

    const error = await rewind(app, "api/T9").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrcError);
    expect((error as OrcError).code).toBe("CHECKPOINT_NOT_FOUND");
  });
});
