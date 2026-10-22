import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/** Fresh temp directory per test, removed afterwards. Call at describe/file scope. */
export function useTmpDir(prefix = "orc-test-"): () => string {
  let dir: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix));
  });
  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  return () => {
    if (dir === undefined) {
      throw new Error("useTmpDir: directory is only available inside a test");
    }
    return dir;
  };
}

/** A fixed local time, so formatted timestamps are deterministic in any time zone. */
export function localTime(minutesPastTen = 0): Date {
  return new Date(2026, 9, 21, 22, minutesPastTen);
}
