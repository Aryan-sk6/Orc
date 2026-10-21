import { appendFile } from "node:fs/promises";
import { KeyedMutex, readFileIfExists, writeFileIfMissing } from "../core/fs.js";
import { assertSessionName, type VaultPaths } from "./layout.js";
import { formatTimestamp } from "./log.js";

export type DecisionStatus = "open" | "resolved";

/** An escalation: what was asked, which default (if any) the driver took, and whether it is settled. */
export interface Decision {
  readonly id: string;
  readonly status: DecisionStatus;
  readonly time: string;
  readonly session: string;
  readonly question: string;
  /** null when no safe default existed and the session was paused. */
  readonly defaultTaken: string | null;
  readonly reversible: boolean;
}

export interface DecisionInput {
  readonly session: string;
  readonly question: string;
  readonly defaultTaken: string | null;
  readonly reversible: boolean;
  readonly now: Date;
}

export const DECISIONS_HEADER =
  "# Decisions\n\nEscalations from drivers. Change `[open]` to `[resolved]` once handled.\n";

const HEADING =
  /^## (D-\d{3,}) \[(open|resolved)\] (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([a-z0-9-]+)$/;
const FIELD = /^- (Question|Default taken|Reversible): (.*)$/;
const NO_DEFAULT = "none";

const fileLocks = new KeyedMutex();

/** Appends an open decision with the next free `D-NNN` id and returns it. */
export async function appendDecision(paths: VaultPaths, input: DecisionInput): Promise<Decision> {
  assertSessionName(input.session);
  return fileLocks.run(paths.decisions, async () => {
    await writeFileIfMissing(paths.decisions, DECISIONS_HEADER);
    const existing = parseDecisions((await readFileIfExists(paths.decisions)) ?? "");
    const decision: Decision = {
      id: nextId(existing),
      status: "open",
      time: formatTimestamp(input.now),
      session: input.session,
      question: oneLine(input.question),
      defaultTaken: input.defaultTaken === null ? null : oneLine(input.defaultTaken),
      reversible: input.reversible,
    };
    await appendFile(paths.decisions, `\n${formatDecision(decision)}`, "utf8");
    return decision;
  });
}

export async function readDecisions(paths: VaultPaths): Promise<Decision[]> {
  return parseDecisions((await readFileIfExists(paths.decisions)) ?? "");
}

export function formatDecision(decision: Decision): string {
  return [
    `## ${decision.id} [${decision.status}] ${decision.time} · ${decision.session}`,
    `- Question: ${decision.question}`,
    `- Default taken: ${decision.defaultTaken ?? NO_DEFAULT}`,
    `- Reversible: ${decision.reversible ? "yes" : "no"}`,
    "",
  ].join("\n");
}

/** Parses decision blocks; text between blocks (human notes) is ignored. */
export function parseDecisions(text: string): Decision[] {
  const decisions: Decision[] = [];
  let current: { -readonly [K in keyof Decision]: Decision[K] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      if (current !== null) {
        decisions.push(current);
      }
      const [, id = "", status, time = "", session = ""] = heading;
      current = {
        id,
        status: status === "resolved" ? "resolved" : "open",
        time,
        session,
        question: "",
        defaultTaken: null,
        reversible: false,
      };
      continue;
    }
    const field = current === null ? null : FIELD.exec(line);
    if (current === null || field === null) {
      continue;
    }
    const [, key, value = ""] = field;
    if (key === "Question") {
      current.question = value;
    } else if (key === "Default taken") {
      current.defaultTaken = value === NO_DEFAULT ? null : value;
    } else {
      current.reversible = value === "yes";
    }
  }
  if (current !== null) {
    decisions.push(current);
  }
  return decisions;
}

function nextId(existing: readonly Decision[]): string {
  const max = existing.reduce((highest, decision) => {
    const number = Number(decision.id.slice(2));
    return Number.isFinite(number) && number > highest ? number : highest;
  }, 0);
  return `D-${String(max + 1).padStart(3, "0")}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
