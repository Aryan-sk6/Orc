import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { parseConfig } from "../config/load.js";
import { OrcError } from "../core/errors.js";
import type { AgentEvent, AgentTurnRequest } from "./adapter.js";
import { createAdapter } from "./create.js";
import { FakeAgentAdapter } from "./fake.js";
import { loadFakeScript } from "./fake-script.js";

const tmp = useTmpDir("orc-fake-");

function request(prompt: string, extra: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return { prompt, cwd: "/app", model: "test-model", access: "read-only", ...extra };
}

async function rejection(promise: Promise<unknown>): Promise<OrcError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof OrcError)) {
    throw new Error(`expected an OrcError, got ${String(error)}`);
  }
  return error;
}

describe("FakeAgentAdapter", () => {
  it("replays turns in order and records every request", async () => {
    const fake = new FakeAgentAdapter({
      turns: [
        { text: "first", costUsd: 0.01 },
        { text: "second", costUsd: 0.02, durationMs: 50 },
      ],
    });
    const one = await fake.runTurn(request("a"));
    const two = await fake.runTurn(request("b", { resumeSessionId: one.sessionId }));

    expect(one).toEqual({
      sessionId: "fake-session-1",
      outcome: "success",
      text: "first",
      costUsd: 0.01,
      durationMs: 0,
      errors: [],
    });
    expect(two.text).toBe("second");
    expect(two.sessionId).toBe("fake-session-1");
    expect(fake.requests.map((r) => r.prompt)).toEqual(["a", "b"]);
    expect(fake.remaining).toBe(0);
  });

  it("gives each new (non-resumed) turn a fresh session id unless the script sets one", async () => {
    const fake = new FakeAgentAdapter({
      turns: [{ text: "x" }, { text: "y" }, { text: "z", sessionId: "scripted" }],
    });
    expect((await fake.runTurn(request("1"))).sessionId).toBe("fake-session-1");
    expect((await fake.runTurn(request("2"))).sessionId).toBe("fake-session-2");
    expect((await fake.runTurn(request("3"))).sessionId).toBe("scripted");
  });

  it("emits the session event, then scripted events", async () => {
    const events: AgentEvent[] = [];
    const fake = new FakeAgentAdapter({
      turns: [{ text: "ok", events: [{ type: "tool", name: "Read" }] }],
    });
    await fake.runTurn(request("go", { onEvent: (event) => events.push(event) }));
    expect(events).toEqual([
      { type: "session", sessionId: "fake-session-1" },
      { type: "tool", name: "Read" },
    ]);
  });

  it("returns empty text and the scripted errors for a non-success outcome", async () => {
    const fake = new FakeAgentAdapter({
      turns: [{ text: "ignored", outcome: "max_budget", costUsd: 1, errors: ["cap"] }],
    });
    const result = await fake.runTurn(request("go"));
    expect(result).toMatchObject({ outcome: "max_budget", text: "", costUsd: 1, errors: ["cap"] });
  });

  it("fails loudly when the prompt does not match `expect`", async () => {
    const fake = new FakeAgentAdapter({ turns: [{ expect: "questions", text: "x" }] });
    const error = await rejection(fake.runTurn(request("write the plan")));
    expect(error.code).toBe("FAKE_SCRIPT_MISMATCH");
  });

  it("fails loudly when the script runs out", async () => {
    const fake = new FakeAgentAdapter({ turns: [] });
    expect((await rejection(fake.runTurn(request("go")))).code).toBe("FAKE_SCRIPT_EXHAUSTED");
  });

  it("returns an error outcome without consuming events when already aborted", async () => {
    const fake = new FakeAgentAdapter({ turns: [{ text: "x" }] });
    const controller = new AbortController();
    controller.abort();
    const result = await fake.runTurn(request("go", { signal: controller.signal }));
    expect(result).toMatchObject({ outcome: "error", errors: ["aborted"] });
  });
});

describe("loadFakeScript", () => {
  it("loads turns and inlines textFile relative to the script", async () => {
    await writeFile(join(tmp(), "out.txt"), "long output\n");
    await writeFile(
      join(tmp(), "script.json"),
      JSON.stringify({ turns: [{ text: "a", costUsd: 0.5 }, { textFile: "out.txt" }] }),
    );
    const script = await loadFakeScript(join(tmp(), "script.json"));
    expect(script.turns.map((turn) => turn.text)).toEqual(["a", "long output\n"]);
    expect(script.turns[0]?.costUsd).toBe(0.5);
  });

  it("reports every problem at once", async () => {
    await writeFile(
      join(tmp(), "bad.json"),
      JSON.stringify({
        turns: [
          { text: "a", textFile: "b" },
          { text: 1 },
          { text: "ok", outcome: "nope", costUsd: -1, extra: true },
          "not an object",
        ],
      }),
    );
    const error = await rejection(loadFakeScript(join(tmp(), "bad.json")));
    expect(error.code).toBe("FAKE_SCRIPT_INVALID");
    expect(error.details).toEqual([
      'turns[0]: needs exactly one of "text" or "textFile"',
      "turns[1].text: must be a string",
      "turns[2].extra: unknown key",
      "turns[2].outcome: must be one of success, max_turns, max_budget, refused, error",
      "turns[2].costUsd: must be a number >= 0",
      "turns[3]: must be an object",
    ]);
  });

  it("names a missing file", async () => {
    const error = await rejection(loadFakeScript(join(tmp(), "missing.json")));
    expect(error.message).toContain("file not found");
  });
});

describe("createAdapter", () => {
  it("builds a FakeAgentAdapter from the configured script", async () => {
    await writeFile(join(tmp(), "orc.fake.json"), JSON.stringify({ turns: [{ text: "hi" }] }));
    const parsed = parseConfig({ adapter: "fake" });
    if (!parsed.ok) {
      throw new Error("config should be valid");
    }
    const adapter = await createAdapter({
      config: parsed.value,
      sourcePath: null,
      rootDir: tmp(),
      vaultPath: join(tmp(), "vault"),
    });
    expect(adapter.name).toBe("fake");
    expect((await adapter.runTurn(request("go"))).text).toBe("hi");
  });

  it("explains that the SDK adapter is not available yet", async () => {
    const parsed = parseConfig({});
    if (!parsed.ok) {
      throw new Error("config should be valid");
    }
    const loaded = { config: parsed.value, sourcePath: null, rootDir: tmp(), vaultPath: tmp() };
    expect((await rejection(createAdapter(loaded))).code).toBe("ADAPTER_UNAVAILABLE");
  });
});
