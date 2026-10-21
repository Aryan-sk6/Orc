import { describe, expect, it } from "vitest";
import { renderTable } from "./table.js";

describe("renderTable", () => {
  it("pads columns to the widest cell and right-aligns numbers", () => {
    const table = renderTable(
      [{ header: "NAME" }, { header: "TOKENS", align: "right" }, { header: "NOTE" }],
      [
        ["api", "48,210", "ok"],
        ["auth-service", "5", ""],
      ],
    );
    expect(table).toBe(
      ["NAME          TOKENS  NOTE", "api           48,210  ok", "auth-service       5"].join("\n"),
    );
  });

  it("truncates cells longer than maxWidth with an ellipsis", () => {
    const table = renderTable([{ header: "TASK", maxWidth: 6 }], [["abcdefghij"], ["abc"]]);
    expect(table.split("\n")).toEqual(["TASK", "abcde…", "abc"]);
  });

  it("renders just the header when there are no rows", () => {
    expect(renderTable([{ header: "A" }, { header: "B" }], [])).toBe("A  B");
  });
});
