import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { type App, setupApp, tasks } from "../../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-rewind-");

async function finishedApp(): Promise<App> {
  const app = await setupApp(tmp(), { api: tasks("One", "Two") });
  await writeFile(
    join(app.root, "orc.config.json"),
    JSON.stringify({
      adapter: "fake",
      checks: [{ name: "ok", command: "true", timeoutMs: 20000 }],
    }),
  );
  await writeFile(
    join(app.root, "orc.fake.json"),
    JSON.stringify({ turns: [{ text: "one" }, { text: "two" }] }),
  );
  expect(await main(["run"], captureIO(app.root, localTime(), { env: app.env }))).toBe(0);
  return app;
}

describe("orc rewind", () => {
  it("lists the checkpoints orc run created", async () => {
    const app = await finishedApp();
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["rewind", "--list"], io)).toBe(0);

    expect(io.out()).toMatch(/api\/T1\s+[0-9a-f]{7}/);
    expect(io.out()).toMatch(/api\/T2\s+[0-9a-f]{7}/);
  });

  it("rewinds to a checkpoint and says what happened", async () => {
    const app = await finishedApp();
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["rewind", "api/T2"], io)).toBe(0);

    expect(io.out()).toContain("Rewound api to api/T2.");
    expect(io.out()).toContain("tag orc-backup/api/1");
    expect(io.out()).toContain("Unticked: T2 (1 tasks still done)");
    expect(io.out()).toContain('Run "orc run"');
  });

  it("needs exactly one checkpoint and exits 1 for an unknown one", async () => {
    const app = await finishedApp();

    const none = captureIO(app.root, localTime(), { env: app.env });
    expect(await main(["rewind"], none)).toBe(2);

    const unknown = captureIO(app.root, localTime(), { env: app.env });
    expect(await main(["rewind", "api/T9"], unknown)).toBe(1);
    expect(unknown.err()).toContain('no checkpoint "api/T9"');
  });

  it("says so when there are no checkpoints", async () => {
    const app = await setupApp(tmp(), { api: tasks("One") });
    await writeFile(join(app.root, "orc.config.json"), "{}");
    const io = captureIO(app.root, localTime(), { env: app.env });

    expect(await main(["rewind", "--list"], io)).toBe(0);

    expect(io.out()).toContain("No checkpoints yet");
  });
});
