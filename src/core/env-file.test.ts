import { describe, expect, it } from "vitest";
import { parseEnvFile } from "./env-file.js";

describe("parseEnvFile", () => {
  it("reads keys, quotes, export prefixes and inline comments", () => {
    const vars = parseEnvFile(
      [
        "# comment",
        "",
        "A=1",
        "export B = two ",
        'C="quoted # not a comment"',
        "D='single'",
        "E=value # comment",
        "F=",
        "not a line",
        "G=a#b",
      ].join("\n"),
    );
    expect(Object.fromEntries(vars)).toEqual({
      A: "1",
      B: "two",
      C: "quoted # not a comment",
      D: "single",
      E: "value",
      F: "",
      G: "a#b",
    });
  });
});
