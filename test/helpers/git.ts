import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, git } from "../../src/git/git.js";

/**
 * An env that isolates git from the developer's machine: no system or global config
 * (so no signing, hooks or aliases leak in) and a fixed identity.
 */
export function gitTestEnv(home: string, identity = true): Env {
  const env: Record<string, string | undefined> = {
    PATH: process.env["PATH"],
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "no-global-gitconfig"),
  };
  if (identity) {
    Object.assign(env, {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });
  } else {
    // Without this, git may guess an identity from the hostname instead of failing.
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.useConfigOnly",
      GIT_CONFIG_VALUE_0: "true",
    });
  }
  return env;
}

/** Creates a repository on branch main with one commit (README.md and a .gitignore). */
export async function initRepo(dir: string, env: Env): Promise<void> {
  await mkdir(dir, { recursive: true });
  const run = { cwd: dir, env };
  await git(["init", "--quiet", "--initial-branch=main"], run);
  await writeFile(join(dir, "README.md"), "# app\n");
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");
  await git(["add", "--all"], run);
  await git(["commit", "--quiet", "-m", "initial"], run);
}
