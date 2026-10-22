import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { type App, setupApp, tasks } from "../../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { commitAll } from "../../git/checkpoints.js";
import { git } from "../../git/git.js";
import { defaultWorktreesDir, ensureWorktree } from "../../git/worktrees.js";
import { markTaskDone } from "../../vault/plan.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-integrate-");

async function appWithFinishedWorkstream(checkCommand: string): Promise<App> {
  const app = await setupApp(tmp(), { api: tasks("Add route") });
  await writeFile(
    join(app.root, "orc.config.json"),
    JSON.stringify({
      adapter: "fake",
      checks: [{ name: "files", command: checkCommand, timeoutMs: 20000 }],
    }),
  );
  const { worktree } = await ensureWorktree(app.repo, {
    name: "api",
    worktreesDir: defaultWorktreesDir(app.root),
  });
  await mkdir(join(worktree.path, "src"), { recursive: true });
  await writeFile(join(worktree.path, "src", "api.txt"), "api\n");
  await commitAll({ path: worktree.path, env: app.env }, "orc(api): T1");
  await markTaskDone(app.vault, "api", "T1");
  return app;
}

describe("orc integrate", () => {
  it("merges, checks and prints where the result is", async () => {
    const app = await appWithFinishedWorkstream("test -f src/api.txt");
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["integrate"], io)).toBe(0);

    expect(io.out()).toMatch(/api\s+merged \(/);
    expect(io.out()).toMatch(/files\s+pass/);
    expect(io.out()).toContain("Branch: orc-integration/m1");
    expect(io.err()).toBe("");
  });

  it("uses --milestone for the branch name", async () => {
    const app = await appWithFinishedWorkstream("true");
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["integrate", "--milestone", "beta"], io)).toBe(0);

    expect(io.out()).toContain("Branch: orc-integration/beta");
  });

  it("exits 1 and points at decisions.md when the checks fail", async () => {
    const app = await appWithFinishedWorkstream("exit 1");
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["integrate"], io)).toBe(1);

    expect(io.out()).toMatch(/files\s+fail/);
    expect(io.out()).toContain("Open decisions: 1");
  });

  it("rejects a bad milestone as a usage error", async () => {
    const app = await appWithFinishedWorkstream("true");
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["integrate", "--milestone", "Bad Name"], io)).toBe(2);
  });

  it("refuses to start while the vault is tracked by git", async () => {
    const app = await appWithFinishedWorkstream("true");
    await git(["add", "-f", "vault"], { cwd: app.root, env: app.env });
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["integrate"], io)).toBe(1);

    expect(io.err()).toContain("tracked by git");
    expect(io.err()).toContain("git rm -r --cached vault");
  });
});
