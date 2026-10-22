import { type Options, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage, OrcError } from "../core/errors.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentOutcome,
  AgentTurnRequest,
  AgentTurnResult,
} from "./adapter.js";

/*
 * AgentAdapter backed by the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
 * This is the ONLY file that imports the SDK. Verified against 0.3.308's sdk.d.ts;
 * see vault/docs/claude-agent-sdk.md and Decisions/0009.
 *
 * One runTurn = one query() call in single-message mode. Follow-up turns pass `resume`,
 * which continues the conversation with full prior context.
 */

/** A running query: an async stream of SDK messages that can be closed. */
export interface QueryHandle extends AsyncIterable<unknown> {
  close(): void;
}

/** The SDK's query(); injected so tests never spawn Claude Code or hit the network. */
export type QueryFn = (params: { prompt: string; options: Options }) => QueryHandle;

export interface ClaudeSdkAdapterOptions {
  /** Environment for the Claude Code subprocess. It REPLACES process.env there, so pass all of it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly query?: QueryFn | undefined;
}

/** Tools a "read-only" turn gets. Grep/Glob are listed explicitly: native builds may omit them otherwise. */
export const READ_ONLY_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

const CLIENT_APP = "orc";
const STDERR_LINES_KEPT = 20;

export class ClaudeSdkAdapter implements AgentAdapter {
  readonly name = "claude-agent-sdk";
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly query: QueryFn;
  /** Last cumulative total_cost_usd reported per session, to turn totals into per-turn deltas. */
  private readonly totals = new Map<string, number>();
  /** Running queries and their abort controllers, so close() can stop them. */
  private readonly active = new Map<QueryHandle, AbortController>();
  private closed = false;

  constructor(options: ClaudeSdkAdapterOptions) {
    this.env = options.env;
    this.query = options.query ?? sdkQuery;
  }

  async runTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    if (this.closed) {
      throw new OrcError("AGENT_FAILED", "claude-agent-sdk adapter: runTurn called after close()");
    }
    const resumed = request.resumeSessionId ?? "";
    if (request.maxBudgetUsd !== undefined && request.maxBudgetUsd <= 0) {
      // The SDK rejects a budget of 0; there is nothing left to spend anyway.
      return failed(resumed, "max_budget", ["no budget left for this turn"]);
    }
    if (request.signal?.aborted === true) {
      return failed(resumed, "error", ["aborted"]);
    }

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const stderr: string[] = [];
    const handle = this.query({
      prompt: request.prompt,
      options: buildOptions(request, this.env, abortController, (data) => {
        stderr.push(...data.split("\n").filter((line) => line.trim() !== ""));
        stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES_KEPT));
      }),
    });
    this.active.set(handle, abortController);

    const turn = new TurnState(resumed, request.onEvent);
    let thrown: unknown;
    try {
      for await (const message of handle) {
        turn.handle(message);
      }
    } catch (error) {
      // On an error result the SDK yields the result and then throws; the result is what counts.
      thrown = error;
    } finally {
      this.active.delete(handle);
      request.signal?.removeEventListener("abort", onAbort);
    }

    const result = turn.result;
    if (result === undefined) {
      if (abortController.signal.aborted) {
        return failed(turn.sessionId, "error", ["aborted"]);
      }
      const reason = thrown === undefined ? "ended without a result" : errorMessage(thrown);
      throw new OrcError("AGENT_FAILED", `Claude Agent SDK: ${reason}`, stderr);
    }
    return {
      sessionId: result.sessionId,
      ...classify(result, turn),
      costUsd: this.turnCost(result),
      durationMs: result.durationMs,
      deniedActions: result.denials,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [handle, controller] of this.active) {
      controller.abort();
      handle.close();
    }
    this.active.clear();
  }

  /**
   * total_cost_usd is cumulative per session: a resumed session starts from the total its
   * transcript saved. Per-turn cost is the increase since the last total seen for the session.
   * A zeroed error result (crash) keeps the previous total. A total below the previous one
   * means the transcript carried no total, so the whole figure is this turn's.
   */
  private turnCost(result: ResultInfo): number {
    const total = result.totalCostUsd;
    const previous = this.totals.get(result.sessionId);
    if (total === 0 && result.subtype !== "success") {
      return 0;
    }
    this.totals.set(result.sessionId, total);
    const cost = previous === undefined || total < previous ? total : total - previous;
    return Math.round(cost * 1e6) / 1e6;
  }
}

/** Maps an AgentTurnRequest onto SDK options. Exported for tests. */
export function buildOptions(
  request: AgentTurnRequest,
  env: Readonly<Record<string, string | undefined>>,
  abortController: AbortController,
  stderr: (data: string) => void,
): Options {
  const options: Options = {
    cwd: request.cwd,
    model: request.model,
    abortController,
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP },
    stderr,
    // Project settings and CLAUDE.md load; the user's ~/.claude settings don't, so runs are reproducible.
    settingSources: ["project"],
    // Nobody is there to approve: anything not pre-approved is denied and reported in permission_denials.
    permissionPrompts: "none",
    systemPrompt:
      request.systemPrompt === undefined
        ? { type: "preset", preset: "claude_code" }
        : { type: "preset", preset: "claude_code", append: request.systemPrompt },
    ...accessOptions(request),
  };
  if (request.resumeSessionId !== undefined) {
    options.resume = request.resumeSessionId;
  }
  if (request.maxBudgetUsd !== undefined) {
    options.maxBudgetUsd = request.maxBudgetUsd;
  }
  if (request.projectRoot !== undefined && request.projectRoot !== request.cwd) {
    options.projectConfigRoot = request.projectRoot;
  }
  return options;
}

function accessOptions(request: AgentTurnRequest): Options {
  if (request.access === "read-only") {
    // `tools` limits what exists at all; dontAsk denies anything that would need approval.
    return {
      tools: [...READ_ONLY_TOOLS],
      allowedTools: [...READ_ONLY_TOOLS],
      permissionMode: "dontAsk",
    };
  }
  // acceptEdits approves file edits and mkdir/touch/mv/cp inside cwd. Other Bash needs an allow
  // rule. "Bash(cmd *)" also matches the bare command, and compound commands must match per part.
  return {
    permissionMode: "acceptEdits",
    allowedTools: (request.allowedCommands ?? [])
      .map((command) => command.trim())
      .filter((command) => command !== "")
      .map((command) => `Bash(${command} *)`),
  };
}

/** The fields of an SDK result message orc uses, read defensively from `unknown`. */
interface ResultInfo {
  readonly subtype: string;
  readonly sessionId: string;
  readonly isError: boolean;
  readonly text: string;
  readonly stopReason: string | null;
  readonly totalCostUsd: number;
  readonly durationMs: number;
  readonly errors: readonly string[];
  readonly denials: readonly string[];
}

/** Collects what a turn's message stream says, emitting progress events as it goes. */
class TurnState {
  sessionId: string;
  result: ResultInfo | undefined;
  refused = false;
  readonly assistantErrors: string[] = [];
  private announced = false;

  constructor(
    sessionId: string,
    private readonly onEvent: ((event: AgentEvent) => void) | undefined,
  ) {
    this.sessionId = sessionId;
  }

  handle(message: unknown): void {
    if (!isObject(message)) {
      return;
    }
    const sessionId = message["session_id"];
    if (typeof sessionId === "string" && sessionId !== "") {
      this.sessionId = sessionId;
      if (!this.announced) {
        this.announced = true;
        this.onEvent?.({ type: "session", sessionId });
      }
    }
    switch (message["type"]) {
      case "assistant":
        this.handleAssistant(message);
        break;
      case "system":
        if (message["subtype"] === "model_refusal_no_fallback") {
          this.refused = true;
        }
        break;
      case "result":
        this.result = readResult(message, this.sessionId);
        break;
    }
  }

  private handleAssistant(message: Readonly<Record<string, unknown>>): void {
    const error = message["error"];
    if (typeof error === "string" && !this.assistantErrors.includes(error)) {
      this.assistantErrors.push(error);
    }
    // Subagent messages carry a parent_tool_use_id; only the main thread is reported.
    const body = message["message"];
    if (message["parent_tool_use_id"] !== null || !isObject(body)) {
      return;
    }
    const content = body["content"];
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content) {
      if (!isObject(block)) {
        continue;
      }
      if (block["type"] === "text" && typeof block["text"] === "string" && block["text"] !== "") {
        this.onEvent?.({ type: "text", text: block["text"] });
      } else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
        this.onEvent?.({ type: "tool", name: block["name"] });
      }
    }
  }
}

function readResult(message: Readonly<Record<string, unknown>>, fallbackId: string): ResultInfo {
  const sessionId = message["session_id"];
  const stopReason = message["stop_reason"];
  return {
    subtype: stringOr(message["subtype"], "unknown"),
    sessionId: typeof sessionId === "string" && sessionId !== "" ? sessionId : fallbackId,
    isError: message["is_error"] === true,
    text: stringOr(message["result"], ""),
    stopReason: typeof stopReason === "string" ? stopReason : null,
    totalCostUsd: nonNegative(message["total_cost_usd"]),
    durationMs: nonNegative(message["duration_ms"]),
    errors: stringArray(message["errors"]),
    denials: readDenials(message["permission_denials"]),
  };
}

const ERROR_SUBTYPES: Readonly<Record<string, AgentOutcome>> = {
  error_max_turns: "max_turns",
  error_max_budget_usd: "max_budget",
};

function classify(
  result: ResultInfo,
  turn: TurnState,
): { outcome: AgentOutcome; text: string; errors: readonly string[] } {
  const extra = turn.assistantErrors.map((error) => `assistant error: ${error}`);
  if (result.subtype === "success") {
    if (result.stopReason === "refusal" || turn.refused) {
      return {
        outcome: "refused",
        text: "",
        errors: [result.text || "the model refused", ...extra],
      };
    }
    if (result.isError) {
      return { outcome: "error", text: "", errors: [result.text || "unknown error", ...extra] };
    }
    return { outcome: "success", text: result.text, errors: [] };
  }
  const outcome = ERROR_SUBTYPES[result.subtype] ?? "error";
  const errors = [...result.errors, ...extra];
  return { outcome, text: "", errors: errors.length > 0 ? errors : [result.subtype] };
}

function readDenials(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const denials: string[] = [];
  for (const denial of value) {
    if (isObject(denial) && typeof denial["tool_name"] === "string") {
      denials.push(describeToolCall(denial["tool_name"], denial["tool_input"]));
    }
  }
  return denials;
}

/** "Bash: rm -rf dist" style summary of a tool call, from its most telling input field. */
function describeToolCall(tool: string, input: unknown): string {
  if (isObject(input)) {
    for (const key of ["command", "file_path", "path", "pattern", "url"]) {
      const value = input[key];
      if (typeof value === "string") {
        return `${tool}: ${value.length > 200 ? `${value.slice(0, 197)}...` : value}`;
      }
    }
  }
  return tool;
}

function failed(sessionId: string, outcome: AgentOutcome, errors: string[]): AgentTurnResult {
  return { sessionId, outcome, text: "", costUsd: 0, durationMs: 0, errors, deniedActions: [] };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
