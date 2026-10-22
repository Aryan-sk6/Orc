import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { type App, setupApp, tasks } from "../../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { git } from "../../git/git.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-run-");

async function appWithConfig(
  workstreams: Record<string, string>,
  turns: readonly object[],
  config: object = {},
): Promise<App> {
  const app = await setupApp(tmp(), workstreams);
  await writeFile(
    join(app.root, "orc.config.json"),
    JSON.stringify({
      adapter: "fake",
      checks: [{ name: "ok", command: "true", timeoutMs: 20000 }],
      ...config,
    }),
  );
  await writeFile(join(app.root, "orc.fake.json"), JSON.stringify({ turns }));
  return app;
}

describe("orc run", () => {
  it("drives the plan to the end and prints a summary", async () => {
    const app = await appWithConfig({ api: tasks("Add route", "Add tests") }, [
      { text: "route", costUsd: 0.1 },
      { text: "tests", costUsd: 0.2 },
    ]);
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(0);

    expect(io.out()).toContain("[api] T1 turn 1");
    expect(io.out()).toContain("[api] all 2 tasks done");
    expect(io.out()).toMatch(/api\s+done\s+2\/2\s+\$0\.30/);
    expect(io.out()).toContain("Spend: $0.30 of $20.00 run cap");
    expect(io.err()).toBe("");
  });

  it("exits 1 and points at decisions.md when a session pauses", async () => {
    const app = await appWithConfig({ api: tasks("Add route") }, [{ text: "route" }], {
      checks: [{ name: "bad", command: "exit 1", timeoutMs: 20000 }],
      retries: { maxPerTask: 0 },
    });
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(1);

    expect(io.out()).toMatch(/api\s+paused\s+0\/1/);
    expect(io.out()).toContain("Open decisions: 1");
  });

  it("exits 130 when interrupted", async () => {
    const app = await appWithConfig({ api: tasks("Add route") }, [{ text: "route" }]);
    const controller = new AbortController();
    controller.abort();
    const io = { ...captureIO(app.root, localTime(), { env: app.env }), signal: controller.signal };

    expect(await main(["run"], io)).toBe(130);
  });

  it("limits the run with --workstream", async () => {
    const app = await appWithConfig({ api: tasks("A"), web: tasks("B") }, [{ text: "a" }]);
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run", "--workstream", "api"], io)).toBe(0);
    expect(io.out()).not.toContain("[web]");
  });

  it("refuses to start without a plan", async () => {
    const app = await appWithConfig({ api: tasks("A") }, []);
    const { rm } = await import("node:fs/promises");
    await rm(app.vault.planDir, { recursive: true });
    await rm(app.vault.contractsDir, { recursive: true });
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(1);
    expect(io.err()).toContain('Run "orc plan <idea.md>" first');
  });

  it("refuses to start while required docs are missing", async () => {
    const app = await appWithConfig({ api: tasks("A") }, []);
    await writeFile(
      join(app.vault.planDir, "docs-needed.md"),
      "## Docs\n- `clerk.md`: Clerk docs, https://clerk.com/docs\n",
    );
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(1);
    expect(io.err()).toContain("setup is incomplete");
    expect(io.err()).toContain("docs/clerk.md is missing");
  });

  it("requires the API key for the real adapter but not for the fake one", async () => {
    const app = await appWithConfig({ api: tasks("A") }, [], { adapter: "claude-agent-sdk" });
    await writeFile(
      join(app.vault.planDir, "setup.md"),
      "## Env vars\n- `DATABASE_URL`: Postgres\n",
    );
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(1);
    expect(io.err()).toContain("env var ANTHROPIC_API_KEY is not set");
    expect(io.err()).toContain("env var DATABASE_URL is not set");
  });

  it("documents itself", async () => {
    const io = captureIO();
    expect(await main(["run", "--help"], io)).toBe(0);
    expect(io.out()).toContain("Usage: orc run");
    expect(io.out()).toContain("retries.maxPerTask");
  });
});

describe("orc run: tracked vault", () => {
  it("refuses to start while the vault is tracked by git", async () => {
    const app = await appWithConfig({ api: tasks("Add route") }, [{ text: "route" }]);
    await git(["add", "-f", "vault"], { cwd: app.root, env: app.env });
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["run"], io)).toBe(1);

    expect(io.err()).toContain("tracked by git");
  });
});
