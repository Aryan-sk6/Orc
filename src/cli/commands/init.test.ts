import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-init-");

describe("orc init", () => {
  it("installs the kit and lists what it did", async () => {
    const io = captureIO(tmp());

    expect(await main(["init"], io)).toBe(0);

    expect(io.out()).toContain("created");
    expect(io.out()).toContain(".claude/skills/orc-plan/SKILL.md");
    expect(io.out()).toContain("/orc-plan");
    expect(await readFile(join(tmp(), ".claude/agents/orc-driver.md"), "utf8")).toContain(
      "name: orc-driver",
    );
  });

  it("reports unchanged files on a second run", async () => {
    await main(["init"], captureIO(tmp()));
    const io = captureIO(tmp());

    expect(await main(["init"], io)).toBe(0);

    expect(io.out()).not.toContain("created");
    expect(io.out()).toContain("unchanged");
  });
});
