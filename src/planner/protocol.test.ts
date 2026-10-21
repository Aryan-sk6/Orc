import { describe, expect, it } from "vitest";
import { parseFileBlocks, parseQuestions, pathProblem } from "./protocol.js";

describe("parseQuestions", () => {
  it("reads the last json block and fills missing why/default with ''", () => {
    const text =
      'Thinking...\n```json\n{"questions":[{"question":"old"}]}\n```\nRevised:\n```json\n{"questions":[{"question":" Stack? ","default":"Next.js"}]}\n```';
    expect(parseQuestions(text)).toEqual({
      ok: true,
      value: [{ question: "Stack?", why: "", default: "Next.js" }],
    });
  });

  it("accepts a bare JSON reply", () => {
    const result = parseQuestions('{"questions":[{"question":"A?","why":"w","default":"d"}]}');
    expect(result.ok).toBe(true);
  });

  it("reports bad JSON, empty lists, too many questions and bad items", () => {
    expect(parseQuestions("no json here").ok).toBe(false);
    expect(parseQuestions('{"questions":[]}').ok).toBe(false);
    const many = { questions: Array.from({ length: 21 }, () => ({ question: "q" })) };
    expect(parseQuestions(JSON.stringify(many))).toEqual({
      ok: false,
      issues: ["ask at most 15 questions, not 21"],
    });
    expect(parseQuestions('{"questions":[{"question":""},"x"]}')).toEqual({
      ok: false,
      issues: [
        'questions[0] needs a non-empty "question" string',
        'questions[1] needs a non-empty "question" string',
      ],
    });
  });
});

describe("parseFileBlocks", () => {
  it("collects blocks, ignores chatter, and ends each file with one newline", () => {
    const text = [
      "Sure, here you go:",
      '<<<orc-file path="plan/a.md">>>',
      "# A",
      "",
      "```",
      "<<<not a marker",
      "```",
      "",
      "",
      "<<<orc-end>>>",
      "between",
      '<<<orc-file path="contracts/types.ts">>>',
      "export type X = 1;",
      "<<<orc-end>>>",
    ].join("\n");
    const result = parseFileBlocks(text);
    expect(result.ok && [...result.value]).toEqual([
      ["plan/a.md", "# A\n\n```\n<<<not a marker\n```\n"],
      ["contracts/types.ts", "export type X = 1;\n"],
    ]);
  });

  it("reports unclosed blocks, duplicates, bad paths and an empty reply", () => {
    expect(parseFileBlocks("nothing")).toEqual({
      ok: false,
      issues: ["the reply contains no <<<orc-file>>> blocks"],
    });
    const text = [
      '<<<orc-file path="plan/a.md">>>',
      "a",
      '<<<orc-file path="plan/a.md">>>',
      "b",
      "<<<orc-end>>>",
      '<<<orc-file path="plan/a.md">>>',
      "<<<orc-end>>>",
      '<<<orc-file path="../escape.md">>>',
      "<<<orc-end>>>",
      '<<<orc-file path="plan/b.md">>>',
    ].join("\n");
    const result = parseFileBlocks(text);
    expect(result.ok ? [] : result.issues).toEqual([
      'file block "plan/a.md" is not closed before "plan/a.md" starts',
      '"plan/a.md" was sent twice',
      "\"../escape.md\": must not contain empty, '.' or '..' segments",
      'file block "plan/b.md" is missing its closing <<<orc-end>>> line',
    ]);
  });
});

describe("pathProblem", () => {
  it("allows plan/ and contracts/ files only", () => {
    expect(pathProblem("plan/workstreams/api.md")).toBeNull();
    expect(pathProblem("contracts/api.ts")).toBeNull();
    expect(pathProblem("src/index.ts")).toBe("must be inside plan/ or contracts/");
    expect(pathProblem("/etc/passwd")).toBe("must be a relative path with forward slashes");
    expect(pathProblem("plan\\x.md")).toBe("must be a relative path with forward slashes");
    expect(pathProblem("plan")).toBe("must name a file inside the folder");
    expect(pathProblem("plan/questions.md")).toBe("is written by orc, not the planner");
    expect(pathProblem("plan/task-graph.md")).toBe("is written by orc, not the planner");
  });
});
