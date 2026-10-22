import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIO } from "../../../test/helpers/cli.js";
import { useTmpDir } from "../../../test/helpers/tmp-dir.js";
import { main } from "../main.js";

const tmp = useTmpDir("orc-cli-stop-");
const LOCK = (): string => join(tmp(), "vault", ".orc-run.json");

async function lock(pid: number): Promise<void> {
  await mkdir(join(tmp(), "vault"), { recursive: true });
  await writeFile(LOCK(), JSON.stringify({ pid, started: "2026-10-22 10:00" }));
}

describe("orc stop", () => {
  it("says so when nothing is running", async () => {
    const io = captureIO(tmp());
    expect(await main(["stop"], { ...io, kill: () => undefined })).toBe(0);
    expect(io.out()).toContain("No orc run is in progress.");
  });

  it("sends SIGTERM to the recorded process", async () => {
    await lock(777);
    const sent: Array<[number, string | number]> = [];
    const io = captureIO(tmp());

    expect(
      await main(["stop"], { ...io, kill: (pid, signal) => void sent.push([pid, signal]) }),
    ).toBe(0);

    expect(sent).toEqual([
      [777, 0],
      [777, "SIGTERM"],
    ]);
    expect(io.out()).toContain("Sent SIGTERM to orc run (pid 777");
  });

  it("removes a stale record when the process is gone and sends nothing", async () => {
    await lock(777);
    const sent: Array<string | number> = [];
    const io = captureIO(tmp());
    const kill = (_pid: number, signal: NodeJS.Signals | 0): void => {
      sent.push(signal);
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    };

    expect(await main(["stop"], { ...io, kill })).toBe(0);

    expect(sent).toEqual([0]);
    expect(io.out()).toContain("not running; removed the stale record");
    await expect(readFile(LOCK(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a process owned by someone else (EPERM) as alive", async () => {
    await lock(1);
    const sent: Array<string | number> = [];
    const io = captureIO(tmp());
    const kill = (_pid: number, signal: NodeJS.Signals | 0): void => {
      sent.push(signal);
      if (signal === "SIGTERM") {
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      }
    };
    await main(["stop"], { ...io, kill });
    expect(sent).toEqual([0, "SIGTERM"]);
  });
});
