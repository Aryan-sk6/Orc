import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { writeFixturePlan } from "../../../test/helpers/plan.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-plan-check-");

describe("orc plan --check", () => {
  it("validates a plan already in the vault and writes the task graph, with no model call", async () => {
    await writeFixturePlan(join(tmp(), "vault"));
    const io = captureIO(tmp());

    expect(await main(["plan", "--check"], io)).toBe(0);

    expect(io.out()).toContain("Plan OK: api (2 tasks, waits on web); web (3 tasks, waits on api)");
    expect(await readFile(join(tmp(), "vault/plan/task-graph.md"), "utf8")).toContain("api");
  });

  it("lists every problem of a broken plan and exits non-zero", async () => {
    await writeFixturePlan(join(tmp(), "vault"));
    await rm(join(tmp(), "vault/plan/setup.md"));
    await writeFile(join(tmp(), "vault/plan/workstreams/api.md"), "# nothing here\n");
    const io = captureIO(tmp());

    expect(await main(["plan", "--check"], io)).not.toBe(0);

    expect(io.err()).toContain("problem");
    expect(io.err()).toContain("plan/setup.md");
    expect(io.err()).toContain("plan/workstreams/api.md");
  });

  it("rejects an idea file together with --check", async () => {
    const io = captureIO(tmp());
    expect(await main(["plan", "--check", "idea.md"], io)).not.toBe(0);
    expect(io.err()).toContain("--check takes no idea file");
  });
});
