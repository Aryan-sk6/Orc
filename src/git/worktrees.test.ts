import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitTestEnv, initRepo } from "../../test/helpers/git.js";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { OrcError } from "../core/errors.js";
import { git, gitOutput } from "./git.js";
import {
  defaultWorktreesDir,
  ensureWorktree,
  listWorktrees,
  openRepo,
  type Repo,
  removeWorktree,
  workstreamBranch,
} from "./worktrees.js";

const tmp = useTmpDir("orc-git-");

async function repo(): Promise<Repo> {
  const env = gitTestEnv(tmp());
  await initRepo(join(tmp(), "app"), env);
  return openRepo(join(tmp(), "app"), env);
}

function worktreesDir(): string {
  return join(tmp(), "app-orc-worktrees");
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

describe("openRepo", () => {
  it("finds the main checkout from the root, a subfolder or a linked worktree", async () => {
    const main = await repo();
    expect(main.root).toBe(await realpath(join(tmp(), "app")));

    await mkdir(join(main.root, "src"));
    expect((await openRepo(join(main.root, "src"), main.env)).root).toBe(main.root);

    const { worktree } = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });
    expect((await openRepo(worktree.path, main.env)).root).toBe(main.root);
  });

  it("reports NOT_A_GIT_REPO outside a repository", async () => {
    const error = await rejection(openRepo(tmp(), gitTestEnv(tmp())));
    expect(error.code).toBe("NOT_A_GIT_REPO");
  });
});

describe("ensureWorktree", () => {
  it("creates branch orc/<name> from HEAD in a sibling folder, then reuses it", async () => {
    const main = await repo();
    const first = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });

    expect(first.created).toBe(true);
    expect(first.worktree).toMatchObject({
      name: "api",
      branch: "orc/api",
      path: join(await realpath(worktreesDir()), "api"),
      head: await gitOutput(["rev-parse", "HEAD"], { cwd: main.root, env: main.env }),
    });
    expect(await readFile(join(first.worktree.path, "README.md"), "utf8")).toBe("# app\n");

    const again = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });
    expect(again).toEqual({ worktree: first.worktree, created: false });
    expect((await listWorktrees(main)).map((wt) => wt.branch)).toEqual([
      "refs/heads/main",
      "refs/heads/orc/api",
    ]);
  });

  it("starts a new branch from the given base", async () => {
    const main = await repo();
    const run = { cwd: main.root, env: main.env };
    const initial = await gitOutput(["rev-parse", "HEAD"], run);
    await writeFile(join(main.root, "later.txt"), "x\n");
    await git(["add", "."], run);
    await git(["commit", "-qm", "later"], run);

    const { worktree } = await ensureWorktree(main, {
      name: "web",
      worktreesDir: worktreesDir(),
      base: initial,
    });
    expect(worktree.head).toBe(initial);
  });

  it("re-attaches an existing branch and recreates a folder deleted by hand", async () => {
    const main = await repo();
    const { worktree } = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });
    const run = { cwd: worktree.path, env: main.env };
    await writeFile(join(worktree.path, "api.ts"), "export {};\n");
    await git(["add", "."], run);
    await git(["commit", "-qm", "api work"], run);
    const head = await gitOutput(["rev-parse", "HEAD"], run);

    await rm(worktree.path, { recursive: true, force: true });
    const recreated = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });

    expect(recreated.created).toBe(true);
    expect(recreated.worktree.head).toBe(head);
    expect(await readFile(join(recreated.worktree.path, "api.ts"), "utf8")).toBe("export {};\n");
  });

  it("refuses conflicts instead of guessing", async () => {
    const main = await repo();
    const dir = worktreesDir();

    await mkdir(join(dir, "web"), { recursive: true });
    expect(
      (await rejection(ensureWorktree(main, { name: "web", worktreesDir: dir }))).message,
    ).toContain("is not a git worktree");

    await git(["worktree", "add", "-q", "-b", "orc/api", join(tmp(), "elsewhere")], {
      cwd: main.root,
      env: main.env,
    });
    expect(
      (await rejection(ensureWorktree(main, { name: "api", worktreesDir: dir }))).message,
    ).toContain("already checked out");

    const inside = await rejection(
      ensureWorktree(main, { name: "db", worktreesDir: join(main.root, ".worktrees") }),
    );
    expect(inside.code).toBe("WORKTREE_CONFLICT");
    expect(inside.message).toContain("outside the main checkout");

    expect(
      (await rejection(ensureWorktree(main, { name: "Bad Name", worktreesDir: dir }))).code,
    ).toBe("INVALID_SESSION_NAME");
  });

  it("explains an empty repository", async () => {
    const env = gitTestEnv(tmp());
    const root = join(tmp(), "empty");
    await mkdir(root);
    await git(["init", "-q"], { cwd: root, env });
    const error = await rejection(
      ensureWorktree(await openRepo(root, env), { name: "api", worktreesDir: worktreesDir() }),
    );
    expect(error.message).toContain("no commits yet");
  });
});

describe("removeWorktree", () => {
  it("removes the folder but keeps the branch, and refuses uncommitted work", async () => {
    const main = await repo();
    const { worktree } = await ensureWorktree(main, { name: "api", worktreesDir: worktreesDir() });

    await writeFile(join(worktree.path, "README.md"), "changed\n");
    expect(
      (await rejection(removeWorktree(main, { name: "api", worktreesDir: worktreesDir() }))).code,
    ).toBe("GIT_FAILED");

    await git(["checkout", "--", "README.md"], { cwd: worktree.path, env: main.env });
    expect(await removeWorktree(main, { name: "api", worktreesDir: worktreesDir() })).toBe(true);
    expect(await removeWorktree(main, { name: "api", worktreesDir: worktreesDir() })).toBe(false);
    const branches = await gitOutput(["branch", "--list", "orc/*"], {
      cwd: main.root,
      env: main.env,
    });
    expect(branches.trim()).toBe("orc/api");
  });
});

describe("naming", () => {
  it("puts worktrees next to the checkout and branches under orc/", () => {
    expect(defaultWorktreesDir("/code/todo")).toBe("/code/todo-orc-worktrees");
    expect(workstreamBranch("api")).toBe("orc/api");
  });
});
