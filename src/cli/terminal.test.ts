import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLineReader } from "./terminal.js";

describe("createLineReader", () => {
  it("writes each prompt, returns lines in order, then null at end of input", async () => {
    const input = new PassThrough();
    let written = "";
    const reader = createLineReader(input, (text) => {
      written += text;
    });
    input.end("first\nsecond\n");
    expect(await reader.readLine("a> ")).toBe("first");
    expect(await reader.readLine("b> ")).toBe("second");
    expect(await reader.readLine("c> ")).toBeNull();
    expect(written).toBe("a> b> c> ");
    reader.close();
  });

  it("can be closed without ever reading", () => {
    const reader = createLineReader(new PassThrough(), () => undefined);
    expect(() => reader.close()).not.toThrow();
  });
});
