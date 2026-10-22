import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { errorCode, OrcError } from "../core/errors.js";
import { KeyedMutex, readFileIfExists, writeFileAtomic } from "../core/fs.js";
import {
  type FrontmatterData,
  type FrontmatterValue,
  parseFrontmatter,
  serializeFrontmatter,
} from "./frontmatter.js";
import { isValidSessionName, sessionNotePath, type VaultPaths } from "./layout.js";
import { formatTimestamp } from "./log.js";

export const SESSION_STATUSES = [
  "pending",
  "running",
  "checking",
  "paused",
  "stopped",
  "done",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Session name of `orc summarize`. Its spend is kept apart from the run cap (Decisions/0012). */
export const SUMMARY_SESSION = "summarize";

export const CHECK_STATUSES = ["pass", "fail", "pending", "skipped"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface CheckSummary {
  readonly name: string;
  readonly status: CheckStatus;
}

/** Machine-readable state of one coding session, stored as the note's frontmatter. */
export interface SessionState {
  readonly session: string;
  readonly workstream: string;
  readonly branch: string;
  readonly status: SessionStatus;
  readonly currentTask: string | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  /** Latest result per check command, in run order. */
  readonly checks: readonly CheckSummary[];
  /**
   * Estimated USD spent by this session (coding turns + its driver), summed from the Agent SDK's
   * per-call `total_cost_usd`. An estimate, not billing data.
   */
  readonly costUsd: number;
  /** The coding agent's session id, so a restarted run can resume the conversation. */
  readonly agentSession: string | null;
  /**
   * True once a resumed session's first turn was counted after an orc restart: the adapter then
   * has no earlier total to subtract, so the saved transcript total may be counted twice.
   */
  readonly costMayBeOvercounted: boolean;
  /** `YYYY-MM-DD HH:mm`, local time. */
  readonly updated: string;
}

export const SESSION_SECTIONS = ["Progress", "Problems", "Decisions"] as const;
export type SessionSection = (typeof SESSION_SECTIONS)[number];

export type SessionNoteResult =
  | { readonly ok: true; readonly state: SessionState }
  | { readonly ok: false; readonly problems: readonly string[] };

export interface SessionNoteRead {
  readonly name: string;
  readonly file: string;
  readonly result: SessionNoteResult;
}

const noteLocks = new KeyedMutex();

export function sessionStateToFrontmatter(state: SessionState): FrontmatterData {
  return {
    session: state.session,
    workstream: state.workstream,
    branch: state.branch,
    status: state.status,
    currentTask: state.currentTask,
    tasksDone: state.tasksDone,
    tasksTotal: state.tasksTotal,
    checks: formatChecks(state.checks),
    costUsd: roundUsd(state.costUsd),
    agentSession: state.agentSession,
    costMayBeOvercounted: state.costMayBeOvercounted,
    updated: state.updated,
  };
}

/** Four decimals keeps sub-cent driver calls visible without float noise like 0.30000000000000004. */
export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Validates frontmatter read back from disk (it may have been hand-edited in Obsidian). */
export function sessionStateFromFrontmatter(data: FrontmatterData): SessionNoteResult {
  const problems: string[] = [];
  const text = (key: string): string => {
    const value = data[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
    problems.push(`${key}: must be a non-empty string`);
    return "";
  };
  const count = (key: string): number => {
    const value = data[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
    problems.push(`${key}: must be an integer >= 0`);
    return 0;
  };

  const session = text("session");
  const workstream = text("workstream");
  const branch = text("branch");
  const updated = text("updated");
  const status = data["status"];
  if (!isOneOf(SESSION_STATUSES, status)) {
    problems.push(`status: must be one of ${SESSION_STATUSES.join(", ")}`);
  }
  const currentTask = data["currentTask"] ?? null;
  if (currentTask !== null && typeof currentTask !== "string") {
    problems.push("currentTask: must be a string or null");
  }
  const tasksDone = count("tasksDone");
  const tasksTotal = count("tasksTotal");
  if (tasksDone > tasksTotal) {
    problems.push("tasksDone: must not exceed tasksTotal");
  }
  const costUsd = data["costUsd"];
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) {
    problems.push("costUsd: must be a number >= 0");
  }
  const agentSession = data["agentSession"] ?? null;
  if (agentSession !== null && typeof agentSession !== "string") {
    problems.push("agentSession: must be a string or null");
  }
  const overcounted = data["costMayBeOvercounted"] ?? false;
  if (typeof overcounted !== "boolean") {
    problems.push("costMayBeOvercounted: must be true or false");
  }
  const checksText = data["checks"] ?? "";
  const checks = typeof checksText === "string" ? parseChecks(checksText) : null;
  if (checks === null) {
    problems.push(`checks: expected "name:${CHECK_STATUSES.join("|")}, ..."`);
  }

  if (
    problems.length > 0 ||
    !isOneOf(SESSION_STATUSES, status) ||
    checks === null ||
    typeof costUsd !== "number" ||
    typeof overcounted !== "boolean"
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    state: {
      session,
      workstream,
      branch,
      status,
      currentTask: typeof currentTask === "string" && currentTask !== "" ? currentTask : null,
      tasksDone,
      tasksTotal,
      checks,
      costUsd,
      agentSession: typeof agentSession === "string" && agentSession !== "" ? agentSession : null,
      costMayBeOvercounted: overcounted,
      updated,
    },
  };
}

/** `typecheck:pass,lint:fail` — compact so it stays one frontmatter scalar. */
export function formatChecks(checks: readonly CheckSummary[]): string {
  return checks.map((check) => `${check.name}:${check.status}`).join(",");
}

export function parseChecks(text: string): CheckSummary[] | null {
  if (text.trim() === "") {
    return [];
  }
  const checks: CheckSummary[] = [];
  for (const part of text.split(",")) {
    const [name, status, ...extra] = part.trim().split(":");
    if (name === undefined || name === "" || extra.length > 0 || !isOneOf(CHECK_STATUSES, status)) {
      return null;
    }
    checks.push({ name, status });
  }
  return checks;
}

export function renderSessionNote(state: SessionState): string {
  const sections = SESSION_SECTIONS.map((section) => `## ${section}\n`).join("\n");
  const body = `# Session ${state.session}\n\nWorkstream: ${state.workstream} · branch \`${state.branch}\`\n\n${sections}`;
  return serializeFrontmatter(sessionStateToFrontmatter(state), body);
}

/**
 * Creates the note, or replaces its frontmatter while keeping the body and any extra
 * frontmatter keys a human added (e.g. Obsidian tags).
 */
export async function writeSessionState(paths: VaultPaths, state: SessionState): Promise<void> {
  const file = sessionNotePath(paths, state.session);
  await noteLocks.run(file, async () => {
    const existing = await readFileIfExists(file);
    if (existing === null) {
      await writeFileAtomic(file, renderSessionNote(state));
      return;
    }
    const parsed = parseFrontmatter(existing);
    const data = { ...parsed.data, ...sessionStateToFrontmatter(state) };
    await writeFileAtomic(file, serializeFrontmatter(data, parsed.body));
  });
}

/** Appends `- [time] text` to the end of a section, creating the section if it is missing. */
export async function appendToSessionSection(
  paths: VaultPaths,
  session: string,
  section: SessionSection,
  text: string,
  now: Date,
): Promise<void> {
  const file = sessionNotePath(paths, session);
  await noteLocks.run(file, async () => {
    const existing = await readFileIfExists(file);
    if (existing === null) {
      throw new OrcError("VAULT_NOT_FOUND", `no session note for "${session}" at ${file}`);
    }
    const parsed = parseFrontmatter(existing);
    const bullet = `- [${formatTimestamp(now)}] ${text.replace(/\s+/g, " ").trim()}`;
    const body = insertIntoSection(parsed.body, section, bullet);
    const hasFrontmatter = Object.keys(parsed.data).length > 0;
    await writeFileAtomic(file, hasFrontmatter ? serializeFrontmatter(parsed.data, body) : body);
  });
}

/** Reads every `sessions/*.md`, sorted by name. Invalid notes are reported, not thrown. */
export async function readSessionNotes(paths: VaultPaths): Promise<SessionNoteRead[]> {
  let files: string[];
  try {
    files = await readdir(paths.sessionsDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const notes = files
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map(async (file): Promise<SessionNoteRead> => {
      const name = basename(file, ".md");
      const path = join(paths.sessionsDir, file);
      const text = await readFileIfExists(path);
      return { name, file: path, result: readNote(name, text ?? "") };
    });
  return Promise.all(notes);
}

function readNote(name: string, text: string): SessionNoteResult {
  if (!isValidSessionName(name)) {
    return { ok: false, problems: [`file name "${name}" is not a valid session name`] };
  }
  const result = sessionStateFromFrontmatter(parseFrontmatter(text).data);
  if (result.ok && result.state.session !== name) {
    return {
      ok: false,
      problems: [`session: "${result.state.session}" does not match file name "${name}"`],
    };
  }
  return result;
}

export function insertIntoSection(body: string, section: string, line: string): string {
  const lines = body.split("\n");
  const heading = `## ${section}`;
  let start = lines.indexOf(heading);
  if (start === -1) {
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
      lines.pop();
    }
    lines.push("", heading, "");
    start = lines.length - 2;
  }

  let end = lines.findIndex((text, index) => index > start && /^#{1,2} /.test(text));
  if (end === -1) {
    end = lines.length;
  }
  let insertAt = end;
  while (insertAt - 1 > start && lines[insertAt - 1]?.trim() === "") {
    insertAt -= 1;
  }
  const needsGap = insertAt === end && end < lines.length;
  lines.splice(insertAt, 0, ...(needsGap ? [line, ""] : [line]));
  return lines.join("\n");
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: FrontmatterValue | undefined,
): value is T {
  return values.some((candidate) => candidate === value);
}
