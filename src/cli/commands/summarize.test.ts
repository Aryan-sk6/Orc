import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { type App, setupApp, tasks } from "../../../test/helpers/driver.js";
import { localTime, useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-summarize-");

const REPLY =
  "## What was built\nThe api.\n\n## What went wrong\nNothing notable.\n\n## Decisions for you\nNone.\n\n## Next steps\n1. Ship it.";

async function app(config: object, turns: readonly object[] = []): Promise<App> {
  const created = await setupApp(tmp(), { api: tasks("Add route") });
  await writeFile(join(created.root, "orc.config.json"), JSON.stringify(config));
  await writeFile(join(created.root, "orc.fake.json"), JSON.stringify({ turns }));
  return created;
}

describe("orc summarize", () => {
  it("writes report.md with the narrative from the (fake) model", async () => {
    const a = await app({ adapter: "fake" }, [{ text: REPLY, costUsd: 0.01 }]);
    const io = captureIO(a.root, localTime(), { env: a.env });

    expect(await main(["summarize"], io)).toBe(0);

    expect(io.out()).toContain(`Wrote ${a.vault.report}`);
    expect(io.out()).toContain("Narrative: written ($0.01");
    expect(await readFile(a.vault.report, "utf8")).toContain("## What was built");
  });

  it("--facts-only needs no model and no API key", async () => {
    const a = await app({ adapter: "claude-agent-sdk" });
    const io = captureIO(a.root, localTime(), { env: a.env });

    expect(await main(["summarize", "--facts-only"], io)).toBe(0);

    expect(io.out()).toContain("Narrative: none (facts only");
    expect(await readFile(a.vault.report, "utf8")).toContain("## Sessions");
  });

  it("needs the API key for the real adapter, like every other model call", async () => {
    const a = await app({ adapter: "claude-agent-sdk" });
    const io = captureIO(a.root, localTime(), { env: a.env });

    expect(await main(["summarize"], io)).toBe(1);

    expect(io.err()).toContain("ANTHROPIC_API_KEY");
  });
});
