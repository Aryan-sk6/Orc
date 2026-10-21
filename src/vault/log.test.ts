import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import { OrcError } from "../core/errors.js";
import { vaultPaths } from "./layout.js";
import {
  appendLog,
  formatLogLine,
  formatTimestamp,
  LOG_HEADER,
  parseLogLine,
  readLogTail,
} from "./log.js";

const tmp = useTmpDir("orc-log-");

describe("formatTimestamp", () => {
  it("formats local time as YYYY-MM-DD HH:mm", () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05 09:07");
  });
});

describe("formatLogLine / parseLogLine", () => {
  it("matches the spec format and round-trips", () => {
    const entry = {
      time: "2026-10-21 22:05",
      session: "api",
      did: "added POST /todos",
      touching: ["src/routes/todos.ts", "src/db/schema.ts"],
    };
    const line = formatLogLine(entry);
    expect(line).toBe(
      "[2026-10-21 22:05][api] added POST /todos | touching: src/routes/todos.ts, src/db/schema.ts",
    );
    expect(parseLogLine(line)).toEqual(entry);
  });

  it("writes '-' when no files were touched and reads it back as empty", () => {
    const line = formatLogLine({
      time: "2026-10-21 22:05",
      session: "web",
      did: "x",
      touching: [],
    });
    expect(line).toBe("[2026-10-21 22:05][web] x | touching: -");
    expect(parseLogLine(line)?.touching).toEqual([]);
  });

  it("splits on the last separator when the description contains it", () => {
    const parsed = parseLogLine("[2026-10-21 22:05][api] a | touching: b | touching: c.ts");
    expect(parsed?.did).toBe("a | touching: b");
    expect(parsed?.touching).toEqual(["c.ts"]);
  });

  it("returns null for headers and malformed lines", () => {
    for (const line of ["# LOG", "", "[bad][api] x", "[2026-10-21 22:05] missing session"]) {
      expect(parseLogLine(line)).toBeNull();
    }
  });
});

describe("appendLog", () => {
  it("creates LOG.md with a header, then appends one line per call", async () => {
    const paths = vaultPaths(join(tmp(), "vault"));
    await appendLog(paths, { session: "api", did: "first", touching: ["a.ts"], now: localTime(1) });
    await appendLog(paths, { session: "web", did: "second", now: localTime(2) });

    expect(await readFile(paths.log, "utf8")).toBe(
      `${LOG_HEADER}[2026-10-21 22:01][api] first | touching: a.ts\n` +
        "[2026-10-21 22:02][web] second | touching: -\n",
    );
  });

  it("collapses multi-line descriptions so every entry stays one line", async () => {
    const paths = vaultPaths(tmp());
    const entry = await appendLog(paths, {
      session: "api",
      did: "fixed\n  lint\terrors",
      touching: [" a.ts ", ""],
      now: localTime(),
    });
    expect(entry.did).toBe("fixed lint errors");
    expect(entry.touching).toEqual(["a.ts"]);
  });

  it("rejects empty descriptions and invalid session names", async () => {
    const paths = vaultPaths(tmp());
    await expect(appendLog(paths, { session: "api", did: "  ", now: localTime() })).rejects.toThrow(
      OrcError,
    );
    await expect(
      appendLog(paths, { session: "API]x", did: "x", now: localTime() }),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_NAME" });
  });

  it("keeps every line intact under concurrent appends", async () => {
    const paths = vaultPaths(tmp());
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        appendLog(paths, { session: `s${index % 5}`, did: `step ${index}`, now: localTime() }),
      ),
    );
    const entries = await readLogTail(paths, 100);
    expect(entries).toHaveLength(50);
    expect(new Set(entries.map((entry) => entry.did)).size).toBe(50);
  });
});

describe("readLogTail", () => {
  it("returns the last n entries, oldest first, skipping non-entries", async () => {
    const paths = vaultPaths(tmp());
    await writeFile(
      paths.log,
      `${LOG_HEADER}[2026-10-21 22:01][a] one | touching: -\nnote by a human\n` +
        "[2026-10-21 22:02][a] two | touching: -\n[2026-10-21 22:03][a] three | touching: -\n",
    );
    const tail = await readLogTail(paths, 2);
    expect(tail.map((entry) => entry.did)).toEqual(["two", "three"]);
  });

  it("returns [] when LOG.md does not exist or n <= 0", async () => {
    const paths = vaultPaths(tmp());
    expect(await readLogTail(paths, 30)).toEqual([]);
    await appendLog(paths, { session: "a", did: "x", now: localTime() });
    expect(await readLogTail(paths, 0)).toEqual([]);
  });
});
