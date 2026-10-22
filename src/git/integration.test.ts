import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitTestEnv, initRepo } from "../../test/helpers/git.js";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { OrcError } from "../core/errors.js";
import { commitAll } from "./checkpoints.js";
import { git, gitOutput } from "./git.js";
import {
  ensureIntegrationWorktree,
  integrationBranch,
  mergeBranch,
  trackedFilesUnder,
} from "./integration.js";
import { defaultWorktreesDir, ensureWorktree, openRepo, type Repo } from "./worktrees.js";

const tmp = useTmpDir("orc-integration-git-");

async function repo(): Promise<Repo> {
  const env = gitTestEnv(tmp());
  await initRepo(join(tmp(), "app"), env);
  return openRepo(join(tmp(), "app"), env);
}

async function commitFile(repo: Repo, name: string, file: string, content: string): Promise<void> {
  const { worktree } = await ensureWorktree(repo, {
    name,
    worktreesDir: defaultWorktreesDir(repo.root),
  });
  await mkdir(join(worktree.path, file, ".."), { recursive: true });
  await writeFile(join(worktree.path, file), content);
  await commitAll({ path: worktree.path, env: repo.env }, `orc(${name}): ${file}`);
}

describe("integrationBranch", () => {
  it("names the branch after the milestone and rejects odd names", () => {
    expect(integrationBranch("m1")).toBe("orc-integration/m1");
    expect(() => integrationBranch("M 1")).toThrow(OrcError);
  });
});

describe("ensureIntegrationWorktree", () => {
  it("creates the branch and worktree once, then reuses them", async () => {
    const r = await repo();
    const dir = defaultWorktreesDir(r.root);

    const first = await ensureIntegrationWorktree(r, { milestone: "m1", worktreesDir: dir });
    const second = await ensureIntegrationWorktree(r, { milestone: "m1", worktreesDir: dir });

    expect(first.created).toBe(true);
    expect(first.worktree.branch).toBe("orc-integration/m1");
    expect(first.worktree.path).toContain("_integration");
    expect(second.created).toBe(false);
    expect(second.worktree.path).toBe(first.worktree.path);
  });
});

describe("mergeBranch", () => {
  it("merges disjoint branches with merge commits and reports up-to-date on a repeat", async () => {
    const r = await repo();
    await commitFile(r, "api", "src/api.ts", "api\n");
    await commitFile(r, "web", "src/web.ts", "web\n");
    const { worktree } = await ensureIntegrationWorktree(r, {
      milestone: "m1",
      worktreesDir: defaultWorktreesDir(r.root),
    });
    const ref = { path: worktree.path, env: r.env };

    const a = await mergeBranch(ref, "orc/api", "merge api");
    const b = await mergeBranch(ref, "orc/web", "merge web");
    const again = await mergeBranch(ref, "orc/api", "merge api");

    expect(a.kind).toBe("merged");
    expect(b.kind).toBe("merged");
    expect(again.kind).toBe("up-to-date");
    const files = await gitOutput(["ls-files"], { cwd: worktree.path, env: r.env });
    expect(files).toContain("src/api.ts");
    expect(files).toContain("src/web.ts");
    expect(await gitOutput(["log", "-1", "--format=%s"], { cwd: worktree.path, env: r.env })).toBe(
      "merge web",
    );
  });

  it("aborts a conflicting merge, names the files and leaves the worktree clean", async () => {
    const r = await repo();
    await commitFile(r, "api", "shared.ts", "from api\n");
    await commitFile(r, "web", "shared.ts", "from web\n");
    const { worktree } = await ensureIntegrationWorktree(r, {
      milestone: "m1",
      worktreesDir: defaultWorktreesDir(r.root),
    });
    const ref = { path: worktree.path, env: r.env };
    await mergeBranch(ref, "orc/api", "merge api");

    const result = await mergeBranch(ref, "orc/web", "merge web");

    expect(result).toEqual({ kind: "conflict", files: ["shared.ts"] });
    expect(await gitOutput(["status", "--porcelain"], { cwd: worktree.path, env: r.env })).toBe("");
    expect(await gitOutput(["show", "HEAD:shared.ts"], { cwd: worktree.path, env: r.env })).toBe(
      "from api",
    );
  });
});

describe("trackedFilesUnder", () => {
  it("lists tracked files below a folder and ignores untracked ones", async () => {
    const r = await repo();
    await mkdir(join(r.root, "vault"));
    await writeFile(join(r.root, "vault", "LOG.md"), "log\n");
    expect(await trackedFilesUnder(r, join(r.root, "vault"))).toEqual([]);

    await git(["add", "vault/LOG.md"], { cwd: r.root, env: r.env });
    expect(await trackedFilesUnder(r, join(r.root, "vault"))).toEqual(["vault/LOG.md"]);
  });

  it("returns nothing for a missing folder or one outside the repository", async () => {
    const r = await repo();
    expect(await trackedFilesUnder(r, join(r.root, "nope"))).toEqual([]);
    expect(await trackedFilesUnder(r, tmp())).toEqual([]);
  });
});
