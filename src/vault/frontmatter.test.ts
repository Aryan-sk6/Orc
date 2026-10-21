import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

describe("frontmatter", () => {
  it("round-trips scalars", () => {
    const data = { name: 'a "quoted": value', count: 3, ratio: 0.5, on: false, none: null };
    const text = serializeFrontmatter(data, "# Body\n");
    expect(parseFrontmatter(text)).toEqual({ data, body: "# Body\n" });
  });

  it("reads unquoted and single-quoted strings from hand edits", () => {
    const parsed = parseFrontmatter("---\nstatus: running\ntask: 'it''s T2'\n---\nbody");
    expect(parsed.data).toEqual({ status: "running", task: "it's T2" });
    expect(parsed.body).toBe("body");
  });

  it("ignores lists, comments and nested lines", () => {
    const parsed = parseFrontmatter("---\ntags:\n  - orc\n# comment\nok: 1\n---\n");
    expect(parsed.data).toEqual({ tags: null, ok: 1 });
  });

  it("treats text without a closed fence as body only", () => {
    expect(parseFrontmatter("# Just a note")).toEqual({ data: {}, body: "# Just a note" });
    expect(parseFrontmatter("---\nkey: 1\nno end")).toEqual({
      data: {},
      body: "---\nkey: 1\nno end",
    });
  });

  it("keeps a malformed quoted string as raw text", () => {
    expect(parseFrontmatter('---\nx: "unterminated\n---\n').data).toEqual({ x: '"unterminated' });
  });
});
