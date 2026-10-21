import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-config-");

describe("orc config", () => {
  it("prints the resolved defaults as JSON when no config file exists", async () => {
    const io = captureIO(tmp());
    expect(await main(["config"], io)).toBe(0);
    const printed: unknown = JSON.parse(io.out());
    expect(printed).toEqual({
      config: DEFAULT_CONFIG,
      sourcePath: null,
      rootDir: tmp(),
      vaultPath: join(tmp(), "vault"),
    });
  });

  it("honours --config / -c", async () => {
    await writeFile(join(tmp(), "alt.json"), JSON.stringify({ adapter: "fake" }));
    for (const flag of ["--config", "-c"]) {
      const io = captureIO(tmp());
      expect(await main(["config", flag, "alt.json"], io)).toBe(0);
      expect(io.out()).toContain('"adapter": "fake"');
    }
  });

  it("exits 1 and prints each issue for an invalid config", async () => {
    await writeFile(
      join(tmp(), "orc.config.json"),
      JSON.stringify({ retries: { maxPerTask: -1 }, extra: 1 }),
    );
    const io = captureIO(tmp());
    expect(await main(["config"], io)).toBe(1);
    expect(io.err()).toContain("has 2 problems:");
    expect(io.err()).toContain("  - retries.maxPerTask: must be an integer >= 0");
    expect(io.err()).toContain("  - extra: unknown key");
  });

  it("exits 1 when an explicit config file is missing", async () => {
    const io = captureIO(tmp());
    expect(await main(["config", "-c", "missing.json"], io)).toBe(1);
    expect(io.err()).toContain("config file not found");
  });
});
