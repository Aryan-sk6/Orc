import { loadConfig } from "../../config/load.js";
import { OrcError } from "../../core/errors.js";
import { isAlive, readRunLock, releaseRunLock } from "../../driver/run-lock.js";
import { vaultPaths } from "../../vault/layout.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";

export const stopCommand: Command = {
  name: "stop",
  summary: "Stop a running `orc run` cleanly (same as pressing Ctrl-C in its terminal)",
  help: `Usage: orc stop

Finds the "orc run" of this project (it records its process id in the vault) and sends it
SIGTERM. The sessions end as "stopped", spend is saved, and "orc run" exits with 130.
Run "orc run" again to continue. If the recorded process is gone (a crash), the stale
record is removed. Needs no API key.
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, {});
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const vault = vaultPaths(loaded.vaultPath);
    const kill = io.kill;
    if (kill === undefined) {
      throw new OrcError("USAGE", "this environment cannot signal processes");
    }

    const lock = await readRunLock(vault);
    if (lock === null) {
      io.stdout("No orc run is in progress.\n");
      return 0;
    }
    if (!isAlive(lock.pid, kill)) {
      await releaseRunLock(vault, lock.pid);
      io.stdout(
        `The orc run recorded as pid ${lock.pid} (started ${lock.started}) is not running; removed the stale record.\n`,
      );
      return 0;
    }
    try {
      kill(lock.pid, "SIGTERM");
    } catch (error) {
      throw new OrcError(
        "USAGE",
        `could not stop pid ${lock.pid}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    io.stdout(
      `Sent SIGTERM to orc run (pid ${lock.pid}, started ${lock.started}). It stops after the current calls end; check "orc status".\n`,
    );
    return 0;
  },
};
