import type {
  Options,
  SDKAssistantMessage,
  SDKPermissionDenial,
  SDKResultError,
  SDKResultSuccess,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import { OrcError } from "../core/errors.js";
import type { AgentEvent, AgentTurnRequest } from "./adapter.js";
import { buildOptions, ClaudeSdkAdapter, type QueryFn, type QueryHandle } from "./claude-sdk.js";

/*
 * No test here starts Claude Code: the adapter gets a scripted query() that replays
 * SDK-shaped messages. The type-level block pins the fields the adapter reads to the
 * installed sdk.d.ts, so an SDK upgrade that renames one fails `npm run typecheck`.
 */

describe("SDK message fields the adapter relies on (type-level)", () => {
  it("match the installed @anthropic-ai/claude-agent-sdk types", () => {
    expectTypeOf<SDKResultSuccess["subtype"]>().toEqualTypeOf<"success">();
    expectTypeOf<SDKResultSuccess["result"]>().toEqualTypeOf<string>();
    expectTypeOf<SDKResultSuccess["is_error"]>().toEqualTypeOf<boolean>();
    expectTypeOf<SDKResultSuccess["stop_reason"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SDKResultSuccess["total_cost_usd"]>().toEqualTypeOf<number>();
    expectTypeOf<SDKResultSuccess["duration_ms"]>().toEqualTypeOf<number>();
    expectTypeOf<SDKResultSuccess["session_id"]>().toEqualTypeOf<string>();
    expectTypeOf<SDKResultSuccess["permission_denials"]>().toEqualTypeOf<SDKPermissionDenial[]>();
    expectTypeOf<SDKResultError["subtype"]>().toEqualTypeOf<
      | "error_during_execution"
      | "error_max_turns"
      | "error_max_budget_usd"
      | "error_max_structured_output_retries"
    >();
    expectTypeOf<SDKResultError["errors"]>().toEqualTypeOf<string[]>();
    expectTypeOf<SDKResultError["total_cost_usd"]>().toEqualTypeOf<number>();
    expectTypeOf<SDKPermissionDenial["tool_name"]>().toEqualTypeOf<string>();
    expectTypeOf<SDKPermissionDenial["tool_input"]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<SDKSystemMessage["subtype"]>().toEqualTypeOf<"init">();
    expectTypeOf<SDKSystemMessage["session_id"]>().toEqualTypeOf<string>();
    expectTypeOf<SDKAssistantMessage["parent_tool_use_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Options["projectConfigRoot"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Options["permissionPrompts"]>().toEqualTypeOf<"host" | "none" | undefined>();
  });
});

const ENV = { ANTHROPIC_API_KEY: "sk-test", PATH: "/usr/bin" };

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    prompt: "do it",
    cwd: "/work/app",
    model: "claude-haiku-5-5",
    access: "edit",
    ...overrides,
  };
}

interface ScriptedCall {
  readonly prompt: string;
  readonly options: Options;
}

interface Script {
  readonly messages: readonly unknown[];
  /** Throw this after yielding every message (the SDK does so after an error result). */
  readonly throwAfter?: Error;
  readonly stderr?: string;
  /** Yield nothing until the turn is aborted, then throw. */
  readonly hangUntilAborted?: boolean;
}

/** A query() that replays one script per call and records what it was called with. */
function scriptedQuery(...scripts: Script[]): {
  query: QueryFn;
  calls: ScriptedCall[];
  closed: () => number;
} {
  const calls: ScriptedCall[] = [];
  let closed = 0;
  const query: QueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options });
    const script = scripts[calls.length - 1];
    if (script === undefined) {
      throw new Error(`no script for query call ${calls.length}`);
    }
    async function* run(): AsyncGenerator<unknown, void> {
      if (script?.stderr !== undefined) {
        options.stderr?.(script.stderr);
      }
      if (script?.hangUntilAborted === true) {
        const signal = options.abortController?.signal;
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        throw new Error("Claude Code process aborted by user");
      }
      for (const message of script?.messages ?? []) {
        yield message;
      }
      if (script?.throwAfter !== undefined) {
        throw script.throwAfter;
      }
    }
    const generator = run();
    const handle: QueryHandle = {
      [Symbol.asyncIterator]: () => generator,
      close: () => {
        closed += 1;
      },
    };
    return handle;
  };
  return { query, calls, closed: () => closed };
}

const init = (sessionId: string) => ({ type: "system", subtype: "init", session_id: sessionId });

function assistant(sessionId: string, content: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    session_id: sessionId,
    parent_tool_use_id: null,
    message: { role: "assistant", content },
    ...extra,
  };
}

function success(sessionId: string, totalCostUsd: number, extra: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    result: "all done",
    stop_reason: "end_turn",
    total_cost_usd: totalCostUsd,
    duration_ms: 1234,
    permission_denials: [],
    ...extra,
  };
}

function errorResult(subtype: string, sessionId: string, totalCostUsd: number, errors: string[]) {
  return {
    type: "result",
    subtype,
    session_id: sessionId,
    is_error: true,
    stop_reason: null,
    total_cost_usd: totalCostUsd,
    duration_ms: 50,
    permission_denials: [],
    errors,
  };
}

async function rejection(promise: Promise<unknown>): Promise<OrcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OrcError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("buildOptions", () => {
  const controller = new AbortController();
  const noStderr = (): void => {};

  it('maps "read-only" to a fixed Read/Glob/Grep surface in dontAsk mode', () => {
    const options = buildOptions(
      request({ access: "read-only", systemPrompt: "You are the planner." }),
      ENV,
      controller,
      noStderr,
    );
    expect(options).toMatchObject({
      cwd: "/work/app",
      model: "claude-haiku-5-5",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "dontAsk",
      permissionPrompts: "none",
      settingSources: ["project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: "You are the planner." },
    });
    expect(options.abortController).toBe(controller);
    expect(options.resume).toBeUndefined();
    expect(options.maxBudgetUsd).toBeUndefined();
  });

  it('maps "edit" to acceptEdits plus one Bash allow rule per command', () => {
    const options = buildOptions(
      request({
        allowedCommands: ["npm run typecheck", " npm test ", ""],
        resumeSessionId: "s-1",
        maxBudgetUsd: 2.5,
        projectRoot: "/work/main",
      }),
      ENV,
      controller,
      noStderr,
    );
    expect(options).toMatchObject({
      permissionMode: "acceptEdits",
      allowedTools: ["Bash(npm run typecheck *)", "Bash(npm test *)"],
      resume: "s-1",
      maxBudgetUsd: 2.5,
      projectConfigRoot: "/work/main",
      systemPrompt: { type: "preset", preset: "claude_code" },
    });
    expect(options.tools).toBeUndefined();
  });

  it("passes the whole env through (the SDK replaces process.env) and names the client", () => {
    const options = buildOptions(request(), ENV, controller, noStderr);
    expect(options.env).toEqual({ ...ENV, CLAUDE_AGENT_SDK_CLIENT_APP: "orc" });
  });

  it("omits projectConfigRoot when the project root is the cwd itself", () => {
    const options = buildOptions(request({ projectRoot: "/work/app" }), ENV, controller, noStderr);
    expect(options.projectConfigRoot).toBeUndefined();
  });
});

describe("ClaudeSdkAdapter.runTurn", () => {
  it("returns the final text, emits progress events and reports denied tool calls", async () => {
    const { query, calls } = scriptedQuery({
      messages: [
        init("s-1"),
        assistant("s-1", [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Reading the plan." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "plan.md" } },
        ]),
        assistant("s-1", [{ type: "text", text: "from a subagent" }], {
          parent_tool_use_id: "t9",
        }),
        success("s-1", 0.0421, {
          permission_denials: [
            { tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "rm -rf dist" } },
            { tool_name: "WebSearch", tool_use_id: "t3", tool_input: {} },
          ],
        }),
      ],
    });
    const events: AgentEvent[] = [];
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });

    const result = await adapter.runTurn(request({ onEvent: (event) => events.push(event) }));

    expect(result).toEqual({
      sessionId: "s-1",
      outcome: "success",
      text: "all done",
      costUsd: 0.0421,
      durationMs: 1234,
      errors: [],
      deniedActions: ["Bash: rm -rf dist", "WebSearch"],
    });
    expect(events).toEqual([
      { type: "session", sessionId: "s-1" },
      { type: "text", text: "Reading the plan." },
      { type: "tool", name: "Read" },
    ]);
    expect(calls[0]?.prompt).toBe("do it");
  });

  it("turns cumulative totals into per-turn costs for a resumed session", async () => {
    const { query, calls } = scriptedQuery(
      { messages: [init("s-1"), success("s-1", 0.04)] },
      { messages: [init("s-1"), success("s-1", 0.35)] },
      { messages: [init("s-2"), success("s-2", 0.1)] },
    );
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });

    const first = await adapter.runTurn(request());
    const second = await adapter.runTurn(request({ resumeSessionId: first.sessionId }));
    const other = await adapter.runTurn(request());

    expect([first.costUsd, second.costUsd, other.costUsd]).toEqual([0.04, 0.31, 0.1]);
    expect(calls[1]?.options.resume).toBe("s-1");
  });

  it("keeps the previous total when a crashed turn reports zeroed totals", async () => {
    const { query } = scriptedQuery(
      { messages: [success("s-1", 0.2)] },
      {
        messages: [errorResult("error_during_execution", "s-1", 0, ["process exited"])],
        throwAfter: new Error("Claude Code process exited with code 1"),
      },
      { messages: [success("s-1", 0.5)] },
    );
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });

    await adapter.runTurn(request());
    const crashed = await adapter.runTurn(request({ resumeSessionId: "s-1" }));
    const after = await adapter.runTurn(request({ resumeSessionId: "s-1" }));

    expect(crashed).toMatchObject({ outcome: "error", costUsd: 0, errors: ["process exited"] });
    expect(after.costUsd).toBe(0.3);
  });

  it("counts the whole total when a resumed session reports less than before", async () => {
    const { query } = scriptedQuery(
      { messages: [success("s-1", 0.5)] },
      { messages: [success("s-1", 0.2)] },
    );
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });
    await adapter.runTurn(request());
    expect((await adapter.runTurn(request({ resumeSessionId: "s-1" }))).costUsd).toBe(0.2);
  });

  it.each([
    ["error_max_turns", "max_turns"],
    ["error_max_budget_usd", "max_budget"],
    ["error_during_execution", "error"],
    ["error_max_structured_output_retries", "error"],
  ] as const)("maps a %s result to outcome %s", async (subtype, outcome) => {
    const { query } = scriptedQuery({
      messages: [errorResult(subtype, "s-1", 0.7, [])],
      throwAfter: new Error("query failed"),
    });
    const result = await new ClaudeSdkAdapter({ env: ENV, query }).runTurn(request());
    expect(result).toMatchObject({ outcome, text: "", costUsd: 0.7, errors: [subtype] });
  });

  it("treats a success result with is_error as an error and adds assistant errors", async () => {
    const { query } = scriptedQuery({
      messages: [
        assistant("s-1", [{ type: "text", text: "Invalid API key" }], {
          error: "authentication_failed",
        }),
        success("s-1", 0, { is_error: true, result: "Invalid API key · Fix external API key" }),
      ],
    });
    const result = await new ClaudeSdkAdapter({ env: ENV, query }).runTurn(request());
    expect(result).toMatchObject({
      outcome: "error",
      text: "",
      errors: ["Invalid API key · Fix external API key", "assistant error: authentication_failed"],
    });
  });

  it("reports a refusal from stop_reason or from a no-fallback refusal message", async () => {
    const { query } = scriptedQuery(
      { messages: [success("s-1", 0.01, { stop_reason: "refusal", result: "" })] },
      {
        messages: [
          { type: "system", subtype: "model_refusal_no_fallback", session_id: "s-2" },
          success("s-2", 0.01),
        ],
      },
    );
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });
    expect(await adapter.runTurn(request())).toMatchObject({
      outcome: "refused",
      errors: ["the model refused"],
    });
    expect((await adapter.runTurn(request())).outcome).toBe("refused");
  });

  it("rejects with AGENT_FAILED and recent stderr when the SDK fails without a result", async () => {
    const { query } = scriptedQuery({
      messages: [],
      stderr: "line one\nNative CLI binary for darwin-arm64 not found\n",
      throwAfter: new Error("Claude Code executable not found"),
    });
    const error = await rejection(new ClaudeSdkAdapter({ env: ENV, query }).runTurn(request()));
    expect(error.code).toBe("AGENT_FAILED");
    expect(error.message).toContain("Claude Code executable not found");
    expect(error.details).toEqual(["line one", "Native CLI binary for darwin-arm64 not found"]);
  });

  it("rejects when the stream ends without a result", async () => {
    const { query } = scriptedQuery({ messages: [init("s-1")] });
    const error = await rejection(new ClaudeSdkAdapter({ env: ENV, query }).runTurn(request()));
    expect(error.message).toContain("ended without a result");
  });

  it('resolves with outcome "error" when the caller aborts mid-turn', async () => {
    const { query } = scriptedQuery({ messages: [], hangUntilAborted: true });
    const controller = new AbortController();
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });

    const pending = adapter.runTurn(request({ resumeSessionId: "s-9", signal: controller.signal }));
    controller.abort();

    expect(await pending).toMatchObject({
      sessionId: "s-9",
      outcome: "error",
      errors: ["aborted"],
    });
  });

  it("does not start a query when no budget or an aborted signal is passed", async () => {
    const { query, calls } = scriptedQuery();
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });

    expect((await adapter.runTurn(request({ maxBudgetUsd: 0 }))).outcome).toBe("max_budget");
    expect((await adapter.runTurn(request({ signal: AbortSignal.abort() }))).errors).toEqual([
      "aborted",
    ]);
    expect(calls).toHaveLength(0);
  });

  it("close() closes running queries and refuses new turns", async () => {
    const { query, closed } = scriptedQuery({ messages: [], hangUntilAborted: true });
    const adapter = new ClaudeSdkAdapter({ env: ENV, query });
    const pending = adapter.runTurn(request());

    await adapter.close();
    expect(closed()).toBe(1);
    expect(await pending).toMatchObject({ outcome: "error", errors: ["aborted"] });
    expect((await rejection(adapter.runTurn(request()))).code).toBe("AGENT_FAILED");
  });
});
