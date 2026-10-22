import { describe, expect, it } from "vitest";
import { parseDriverReply } from "./reply.js";

const block = (value: unknown): string => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

describe("parseDriverReply", () => {
  it("reads a fix", () => {
    expect(
      parseDriverReply(block({ action: "fix", prompt: "  Remove the unused import.  " })),
    ).toEqual({ ok: true, value: { action: "fix", prompt: "Remove the unused import." } });
  });

  it("reads an escalation with a reversible default", () => {
    expect(
      parseDriverReply(
        block({ action: "escalate", question: "Which ORM?", default: "Drizzle", reversible: true }),
      ),
    ).toEqual({
      ok: true,
      value: {
        action: "escalate",
        question: "Which ORM?",
        defaultTaken: "Drizzle",
        reversible: true,
      },
    });
  });

  it("treats a missing default as none and a missing reversible flag as false", () => {
    expect(parseDriverReply(block({ action: "escalate", question: "Which ORM?" }))).toEqual({
      ok: true,
      value: { action: "escalate", question: "Which ORM?", defaultTaken: null, reversible: false },
    });
  });

  it("accepts bare JSON and takes the last fenced block when there are several", () => {
    expect(parseDriverReply('{"action":"fix","prompt":"x"}').ok).toBe(true);
    const text = `${block({ action: "fix", prompt: "first" })}\nmeh\n${block({ action: "fix", prompt: "second" })}`;
    expect(parseDriverReply(text)).toMatchObject({ ok: true, value: { prompt: "second" } });
  });

  it.each([
    ["prose", "Try fixing the lint error.", "no valid"],
    ["an array", "[1]", "must be an object"],
    ["an unknown action", block({ action: "retry" }), '"action" must be'],
    ["a fix without a prompt", block({ action: "fix" }), "non-empty"],
    ["an empty prompt", block({ action: "fix", prompt: " " }), "non-empty"],
    ["a very long prompt", block({ action: "fix", prompt: "x".repeat(2001) }), "under 2000"],
    ["an escalation without a question", block({ action: "escalate" }), "question"],
    [
      "a numeric default",
      block({ action: "escalate", question: "q", default: 3 }),
      '"default" must be',
    ],
    [
      "a non-boolean reversible",
      block({ action: "escalate", question: "q", reversible: "yes" }),
      '"reversible" must be',
    ],
  ])("rejects %s", (_name, text, issue) => {
    const result = parseDriverReply(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain(issue);
    }
  });
});
