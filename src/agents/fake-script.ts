import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { errorCode, errorMessage, OrcError } from "../core/errors.js";
import { AGENT_OUTCOMES, type AgentEvent, type AgentOutcome } from "./adapter.js";
import type { FakeScript, FakeTurn } from "./fake.js";

/*
 * A fake script file is JSON: { "turns": [ { "text": "...", "costUsd": 0.01 }, ... ] }.
 * A turn may use "textFile" (relative to the script) instead of "text" for long outputs.
 */

type JsonObject = Readonly<Record<string, unknown>>;

const TURN_KEYS = [
  "expect",
  "text",
  "textFile",
  "outcome",
  "costUsd",
  "durationMs",
  "errors",
  "sessionId",
  "events",
] as const;

/** Reads and validates a fake script, inlining any `textFile`. Reports every problem at once. */
export async function loadFakeScript(path: string): Promise<FakeScript> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const reason = errorCode(error) === "ENOENT" ? "file not found" : errorMessage(error);
    throw new OrcError("FAKE_SCRIPT_INVALID", `cannot load fake script ${path}: ${reason}`);
  }

  const problems: string[] = [];
  if (!isJsonObject(raw) || !Array.isArray(raw["turns"])) {
    throw new OrcError("FAKE_SCRIPT_INVALID", `fake script ${path} must be { "turns": [...] }`);
  }
  const turns: FakeTurn[] = [];
  for (const [index, item] of raw["turns"].entries()) {
    const turn = await readTurn(item, `turns[${index}]`, dirname(path), problems);
    if (turn !== undefined) {
      turns.push(turn);
    }
  }
  if (problems.length > 0) {
    throw new OrcError("FAKE_SCRIPT_INVALID", `fake script ${path} is invalid:`, problems);
  }
  return { turns };
}

async function readTurn(
  item: unknown,
  path: string,
  baseDir: string,
  problems: string[],
): Promise<FakeTurn | undefined> {
  if (!isJsonObject(item)) {
    problems.push(`${path}: must be an object`);
    return undefined;
  }
  for (const key of Object.keys(item)) {
    if (!TURN_KEYS.some((allowed) => allowed === key)) {
      problems.push(`${path}.${key}: unknown key`);
    }
  }

  const text = await readText(item, path, baseDir, problems);
  const outcome = item["outcome"];
  if (outcome !== undefined && !isOutcome(outcome)) {
    problems.push(`${path}.outcome: must be one of ${AGENT_OUTCOMES.join(", ")}`);
  }
  const turn: FakeTurn = {
    expect: optionalString(item, "expect", path, problems),
    text: text ?? "",
    outcome: isOutcome(outcome) ? outcome : undefined,
    costUsd: optionalNumber(item, "costUsd", path, problems),
    durationMs: optionalNumber(item, "durationMs", path, problems),
    errors: optionalStrings(item, "errors", path, problems),
    sessionId: optionalString(item, "sessionId", path, problems),
    events: readEvents(item, path, problems),
  };
  return text === undefined ? undefined : turn;
}

async function readText(
  item: JsonObject,
  path: string,
  baseDir: string,
  problems: string[],
): Promise<string | undefined> {
  const text = item["text"];
  const textFile = item["textFile"];
  if ((text === undefined) === (textFile === undefined)) {
    problems.push(`${path}: needs exactly one of "text" or "textFile"`);
    return undefined;
  }
  if (typeof text === "string") {
    return text;
  }
  if (typeof textFile === "string") {
    try {
      return await readFile(resolve(baseDir, textFile), "utf8");
    } catch (error) {
      problems.push(`${path}.textFile: cannot read ${textFile}: ${errorMessage(error)}`);
      return undefined;
    }
  }
  problems.push(`${path}.${text === undefined ? "textFile" : "text"}: must be a string`);
  return undefined;
}

function readEvents(item: JsonObject, path: string, problems: string[]): AgentEvent[] | undefined {
  const value = item["events"];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    problems.push(`${path}.events: must be an array`);
    return undefined;
  }
  const events: AgentEvent[] = [];
  for (const [index, event] of value.entries()) {
    if (isJsonObject(event) && event["type"] === "text" && typeof event["text"] === "string") {
      events.push({ type: "text", text: event["text"] });
    } else if (
      isJsonObject(event) &&
      event["type"] === "tool" &&
      typeof event["name"] === "string"
    ) {
      events.push({ type: "tool", name: event["name"] });
    } else {
      problems.push(`${path}.events[${index}]: must be {type:"text",text} or {type:"tool",name}`);
    }
  }
  return events;
}

function optionalString(
  item: JsonObject,
  key: string,
  path: string,
  problems: string[],
): string | undefined {
  const value = item[key];
  if (value === undefined || typeof value === "string") {
    return value;
  }
  problems.push(`${path}.${key}: must be a string`);
  return undefined;
}

function optionalNumber(
  item: JsonObject,
  key: string,
  path: string,
  problems: string[],
): number | undefined {
  const value = item[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  problems.push(`${path}.${key}: must be a number >= 0`);
  return undefined;
}

function optionalStrings(
  item: JsonObject,
  key: string,
  path: string,
  problems: string[],
): string[] | undefined {
  const value = item[key];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  problems.push(`${path}.${key}: must be an array of strings`);
  return undefined;
}

function isOutcome(value: unknown): value is AgentOutcome {
  return AGENT_OUTCOMES.some((outcome) => outcome === value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
