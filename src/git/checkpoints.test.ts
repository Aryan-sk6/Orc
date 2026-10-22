import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitTestEnv, initRepo } from "../../test/helpers/git.js";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { OrcError } from "../core/errors.js";
import {
  commitAll,
  createCheckpoint,
  findCheckpoint,
  listCheckpoints,
  rewindToCheckpoint,
  type WorktreeRef,
} from "./checkpoints.js";
import { gitOutput } from "./git.js";
import { ensureWorktree, openRepo, type Repo } from "./worktrees.js";

const tmp = useTmpDir("orc-cp-");

async function setup(name = "api"): Promise<{ repo: Repo; wt: WorktreeRef }> {
  const env = gitTestEnv(tmp());
  await initRepo(join(tmp(), "app"), env);
  const repo = await openRepo(join(tmp(), "app"), env);
  const { worktree } = await ensureWorktree(repo, {
    name,
    worktreesDir: join(tmp(), "worktrees"),
  });
  return { repo, wt: { path: worktree.path, env } };
}

function head(wt: WorktreeRef): Promise<string> {
  return gitOutput(["rev-parse", "HEAD"], { cwd: wt.path, env: wt.env });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function rejection(promise: Promise<unknown>): Promise<OrcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OrcError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("commitAll", () => {
  it("commits tracked and new files, and returns null when there is nothing to commit", async () => {
    const { wt } = await setup();
    expect(await commitAll(wt, "nothing")).toBeNull();

    await writeFile(join(wt.path, "new.ts"), "export {};\n");
    const commit = await commitAll(wt, "orc(api): work");
    expect(commit).toBe(await head(wt));
    const files = await gitOutput(["show", "--name-only", "--format=%s", "HEAD"], {
      cwd: wt.path,
      env: wt.env,
    });
    expect(files.split("\n")).toEqual(["orc(api): work", "", "new.ts"]);
  });

  it("explains a missing git identity", async () => {
    const { wt } = await setup();
    await writeFile(join(wt.path, "new.ts"), "x\n");
    const error = await rejection(commitAll({ ...wt, env: gitTestEnv(tmp(), false) }, "work"));
    expect(error.message).toContain("git config user.name");
  });
});

describe("createCheckpoint", () => {
  it("tags HEAD as orc-cp/<workstream>/<task> and is idempotent", async () => {
    const { repo, wt } = await setup();
    const first = await createCheckpoint(wt, { workstream: "api", task: "T1" });

    expect(first).toEqual({
      checkpoint: {
        id: "api/T1",
        tag: "orc-cp/api/T1",
        workstream: "api",
        task: "T1",
        attempt: 1,
        commit: await head(wt),
      },
      savedWork: false,
    });
    expect(await createCheckpoint(wt, { workstream: "api", task: "T1" })).toEqual(first);
    expect(await listCheckpoints(repo)).toEqual([first.checkpoint]);
  });

  it("saves pending work first, and numbers a re-checkpoint at another commit", async () => {
    const { wt } = await setup();
    await createCheckpoint(wt, { workstream: "api", task: "T1" });

    await writeFile(join(wt.path, "retry.ts"), "export {};\n");
    const second = await createCheckpoint(wt, { workstream: "api", task: "T1" });

    expect(second.savedWork).toBe(true);
    expect(second.checkpoint).toMatchObject({ id: "api/T1.2", attempt: 2, commit: await head(wt) });
    const subject = await gitOutput(["log", "-1", "--format=%s"], { cwd: wt.path, env: wt.env });
    expect(subject).toBe("orc(api): save work before T1");
  });

  it("rejects task ids that can't be part of a tag", async () => {
    const { wt } = await setup();
    expect((await rejection(createCheckpoint(wt, { workstream: "api", task: "T 1" }))).code).toBe(
      "GIT_FAILED",
    );
  });
});

describe("listCheckpoints and findCheckpoint", () => {
  it("orders by workstream, task number and attempt, and filters by workstream", async () => {
    const { repo, wt } = await setup();
    const { worktree: web } = await ensureWorktree(repo, {
      name: "web",
      worktreesDir: join(tmp(), "worktrees"),
    });
    const webRef = { path: web.path, env: wt.env };
    for (const task of ["T10", "T2", "T1"]) {
      await writeFile(join(wt.path, `${task}.txt`), task);
      await createCheckpoint(wt, { workstream: "api", task });
    }
    await createCheckpoint(webRef, { workstream: "web", task: "T1" });
    await writeFile(join(wt.path, "again.txt"), "x");
    await createCheckpoint(wt, { workstream: "api", task: "T2" });

    expect((await listCheckpoints(repo)).map((cp) => cp.id)).toEqual([
      "api/T1",
      "api/T2",
      "api/T2.2",
      "api/T10",
      "web/T1",
    ]);
    expect((await listCheckpoints(repo, "web")).map((cp) => cp.id)).toEqual(["web/T1"]);
    expect((await findCheckpoint(repo, "api/T2.2")).attempt).toBe(2);
  });

  it("reports unknown or malformed ids", async () => {
    const { repo } = await setup();
    for (const id of ["api/T9", "nonsense", "../x"]) {
      expect((await rejection(findCheckpoint(repo, id))).code).toBe("CHECKPOINT_NOT_FOUND");
    }
  });
});

describe("rewindToCheckpoint", () => {
  it("restores the checkpoint, backs up current work, and keeps ignored files", async () => {
    const { repo, wt } = await setup();
    await writeFile(join(wt.path, "a.ts"), "v1\n");
    const { checkpoint } = await createCheckpoint(wt, { workstream: "api", task: "T2" });

    await writeFile(join(wt.path, "a.ts"), "v2\n");
    await writeFile(join(wt.path, "untracked.ts"), "new\n");
    await mkdir(join(wt.path, "node_modules"));
    await writeFile(join(wt.path, "node_modules", "dep.js"), "dep\n");

    const { backupTag } = await rewindToCheckpoint(wt, checkpoint);

    expect(backupTag).toBe("orc-backup/api/1");
    expect(await head(wt)).toBe(checkpoint.commit);
    expect(await readFile(join(wt.path, "a.ts"), "utf8")).toBe("v1\n");
    expect(await exists(join(wt.path, "untracked.ts"))).toBe(false);
    expect(await exists(join(wt.path, "node_modules", "dep.js"))).toBe(true);
    const saved = await gitOutput(["show", `${backupTag}:untracked.ts`], {
      cwd: repo.root,
      env: repo.env,
    });
    expect(saved).toBe("new");

    await writeFile(join(wt.path, "a.ts"), "v3\n");
    expect((await rewindToCheckpoint(wt, checkpoint)).backupTag).toBe("orc-backup/api/2");
  });

  it("refuses to rewind a checkout that is not on the workstream's branch", async () => {
    const { repo, wt } = await setup();
    const { checkpoint } = await createCheckpoint(wt, { workstream: "api", task: "T1" });
    const error = await rejection(
      rewindToCheckpoint({ path: repo.root, env: repo.env }, checkpoint),
    );
    expect(error.code).toBe("WORKTREE_CONFLICT");
    expect(error.message).toContain("refs/heads/main");
  });
});
