import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import { appendDecision, DECISIONS_HEADER, parseDecisions, readDecisions } from "./decisions.js";
import { vaultPaths } from "./layout.js";

const tmp = useTmpDir("orc-decisions-");

describe("appendDecision", () => {
  it("creates decisions.md and appends numbered open decisions", async () => {
    const paths = vaultPaths(tmp());
    const first = await appendDecision(paths, {
      session: "api",
      question: "Soft-delete todos?",
      defaultTaken: "yes, deleted_at column",
      reversible: true,
      now: localTime(5),
    });
    await appendDecision(paths, {
      session: "web",
      question: "Retry cap hit on T2: lint keeps failing",
      defaultTaken: null,
      reversible: false,
      now: localTime(6),
    });

    expect(first.id).toBe("D-001");
    expect(await readFile(paths.decisions, "utf8")).toBe(
      `${DECISIONS_HEADER}\n## D-001 [open] 2026-10-21 22:05 · api\n- Question: Soft-delete todos?\n` +
        "- Default taken: yes, deleted_at column\n- Reversible: yes\n" +
        "\n## D-002 [open] 2026-10-21 22:06 · web\n- Question: Retry cap hit on T2: lint keeps failing\n" +
        "- Default taken: none\n- Reversible: no\n",
    );
  });

  it("allocates unique ids under concurrent appends", async () => {
    const paths = vaultPaths(tmp());
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        appendDecision(paths, {
          session: "api",
          question: `q${index}`,
          defaultTaken: null,
          reversible: false,
          now: localTime(),
        }),
      ),
    );
    const ids = (await readDecisions(paths)).map((decision) => decision.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toContain("D-010");
  });

  it("continues numbering after hand-edited and resolved entries", async () => {
    const paths = vaultPaths(tmp());
    await writeFile(
      paths.decisions,
      `${DECISIONS_HEADER}\n## D-007 [resolved] 2026-10-20 10:00 · api\n- Question: old\n` +
        "- Default taken: none\n- Reversible: no\nResolved by hand: use UUIDs.\n",
    );
    const next = await appendDecision(paths, {
      session: "api",
      question: "new",
      defaultTaken: null,
      reversible: false,
      now: localTime(),
    });
    expect(next.id).toBe("D-008");
  });
});

describe("parseDecisions", () => {
  it("reads status, fields and ignores free text", () => {
    const decisions = parseDecisions(
      "# Decisions\n\n## D-001 [resolved] 2026-10-21 22:05 · api\n- Question: Q?\n" +
        "- Default taken: yes\n- Reversible: yes\nSome human note\n" +
        "## D-002 [open] 2026-10-21 22:06 · web\n- Question: R?\n- Default taken: none\n- Reversible: no\n",
    );
    expect(decisions).toEqual([
      {
        id: "D-001",
        status: "resolved",
        time: "2026-10-21 22:05",
        session: "api",
        question: "Q?",
        defaultTaken: "yes",
        reversible: true,
      },
      {
        id: "D-002",
        status: "open",
        time: "2026-10-21 22:06",
        session: "web",
        question: "R?",
        defaultTaken: null,
        reversible: false,
      },
    ]);
  });

  it("returns [] for a missing or empty file", async () => {
    expect(await readDecisions(vaultPaths(tmp()))).toEqual([]);
    expect(parseDecisions("")).toEqual([]);
  });
});
