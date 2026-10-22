import { rm } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, OrcError } from "../core/errors.js";
import { readFileIfExists, writeFileAtomic } from "../core/fs.js";
import type { VaultPaths } from "../vault/layout.js";

/** Name of the file in the vault that says which process is running `orc run`. Hidden: not a note. */
export const RUN_LOCK_FILE = ".orc-run.json";

export interface RunLock {
  readonly pid: number;
  /** `YYYY-MM-DD HH:mm`, local time. */
  readonly started: string;
}

/** Signals a process; throws like `process.kill`. Injected so tests never signal real processes. */
export type KillFn = (pid: number, signal: NodeJS.Signals | 0) => void;

export function runLockPath(paths: VaultPaths): string {
  return join(paths.root, RUN_LOCK_FILE);
}

export async function readRunLock(paths: VaultPaths): Promise<RunLock | null> {
  const text = await readFileIfExists(runLockPath(paths));
  if (text === null) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === "object" && raw !== null) {
      const pid: unknown = Reflect.get(raw, "pid");
      const started: unknown = Reflect.get(raw, "started");
      if (
        typeof pid === "number" &&
        Number.isInteger(pid) &&
        pid > 0 &&
        typeof started === "string"
      ) {
        return { pid, started };
      }
    }
  } catch {
    // Falls through: an unreadable lock counts as stale.
  }
  return null;
}

/** True if the process exists. EPERM means it exists but belongs to someone else. */
export function isAlive(pid: number, kill: KillFn): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * Records this process as the running `orc run`. Refuses if another live process holds the lock;
 * a lock left by a crashed run is replaced.
 */
export async function acquireRunLock(
  paths: VaultPaths,
  lock: RunLock,
  kill: KillFn,
): Promise<void> {
  const existing = await readRunLock(paths);
  if (existing !== null && existing.pid !== lock.pid && isAlive(existing.pid, kill)) {
    throw new OrcError(
      "RUN_ACTIVE",
      `orc run is already running (pid ${existing.pid}, started ${existing.started}). Stop it with "orc stop".`,
    );
  }
  await writeFileAtomic(runLockPath(paths), `${JSON.stringify(lock)}\n`);
}

/** Removes the lock, but only if it is still ours. */
export async function releaseRunLock(paths: VaultPaths, pid: number): Promise<void> {
  const existing = await readRunLock(paths);
  if (existing === null || existing.pid === pid) {
    await rm(runLockPath(paths), { force: true });
  }
}
