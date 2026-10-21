import { appendFile } from "node:fs/promises";
import { OrcError } from "../core/errors.js";
import { readFileIfExists, writeFileIfMissing } from "../core/fs.js";
import { assertSessionName, type VaultPaths } from "./layout.js";

/** One LOG.md line: `[YYYY-MM-DD HH:mm][session] did X | touching: a.ts, b.ts`. */
export interface LogEntry {
  readonly time: string;
  readonly session: string;
  readonly did: string;
  readonly touching: readonly string[];
}

export interface AppendLogInput {
  readonly session: string;
  readonly did: string;
  readonly touching?: readonly string[] | undefined;
  readonly now: Date;
}

export const LOG_HEADER =
  "# LOG\n\nOne line per update from every session: `[time][session] did X | touching: files`.\n\n";

const TOUCHING_SEPARATOR = " | touching: ";
const NO_FILES = "-";
const LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\[([^\]]+)\] (.*)$/;

/** Local wall-clock time as `YYYY-MM-DD HH:mm`. */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function formatLogLine(entry: LogEntry): string {
  const touching = entry.touching.length === 0 ? NO_FILES : entry.touching.join(", ");
  return `[${entry.time}][${entry.session}] ${entry.did}${TOUCHING_SEPARATOR}${touching}`;
}

/** Parses one LOG.md line; returns null for headers, blank lines and anything off-format. */
export function parseLogLine(line: string): LogEntry | null {
  const match = LINE.exec(line);
  const time = match?.[1];
  const session = match?.[2];
  const rest = match?.[3];
  if (time === undefined || session === undefined || rest === undefined) {
    return null;
  }
  // `did` is free text, so split on the last separator.
  const split = rest.lastIndexOf(TOUCHING_SEPARATOR);
  if (split === -1) {
    return { time, session, did: rest, touching: [] };
  }
  const files = rest.slice(split + TOUCHING_SEPARATOR.length).trim();
  return {
    time,
    session,
    did: rest.slice(0, split),
    touching: files === NO_FILES ? [] : files.split(/,\s*/).filter((file) => file !== ""),
  };
}

/**
 * Appends one line to LOG.md, creating it (with a header) if needed.
 * A single small append is atomic on POSIX, so concurrent sessions don't interleave lines.
 */
export async function appendLog(paths: VaultPaths, input: AppendLogInput): Promise<LogEntry> {
  assertSessionName(input.session);
  const did = toOneLine(input.did);
  if (did === "") {
    throw new OrcError("INVALID_LOG_ENTRY", "log entry must describe what was done");
  }
  const entry: LogEntry = {
    time: formatTimestamp(input.now),
    session: input.session,
    did,
    touching: (input.touching ?? []).map(toOneLine).filter((file) => file !== ""),
  };
  await writeFileIfMissing(paths.log, LOG_HEADER);
  await appendFile(paths.log, `${formatLogLine(entry)}\n`, "utf8");
  return entry;
}

/** Last `count` well-formed entries, oldest first. Drivers feed these into prompts. */
export async function readLogTail(paths: VaultPaths, count: number): Promise<LogEntry[]> {
  const text = await readFileIfExists(paths.log);
  if (text === null || count <= 0) {
    return [];
  }
  const entries = text
    .split(/\r?\n/)
    .map(parseLogLine)
    .filter((entry): entry is LogEntry => entry !== null);
  return entries.slice(-count);
}

function toOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
