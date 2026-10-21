import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import { parseFrontmatter } from "./frontmatter.js";
import { vaultPaths } from "./layout.js";
import {
  appendToSessionSection,
  insertIntoSection,
  parseChecks,
  readSessionNotes,
  renderSessionNote,
  type SessionState,
  sessionStateFromFrontmatter,
  sessionStateToFrontmatter,
  writeSessionState,
} from "./session-note.js";

const tmp = useTmpDir("orc-session-");

const STATE: SessionState = {
  session: "api",
  workstream: "backend",
  branch: "orc/api",
  status: "running",
  currentTask: "T3 Add POST /todos",
  tasksDone: 2,
  tasksTotal: 5,
  checks: [
    { name: "typecheck", status: "pass" },
    { name: "lint", status: "fail" },
  ],
  costUsd: 0.4821,
  updated: "2026-10-21 22:05",
};

describe("session state <-> frontmatter", () => {
  it("round-trips", () => {
    expect(sessionStateFromFrontmatter(sessionStateToFrontmatter(STATE))).toEqual({
      ok: true,
      state: STATE,
    });
  });

  it("maps an empty currentTask to null and accepts empty checks", () => {
    const data = { ...sessionStateToFrontmatter(STATE), currentTask: "", checks: "" };
    const result = sessionStateFromFrontmatter(data);
    expect(result.ok && result.state.currentTask).toBeNull();
    expect(result.ok && result.state.checks).toEqual([]);
  });

  it("reports every problem in hand-edited frontmatter", () => {
    const result = sessionStateFromFrontmatter({
      session: "api",
      status: "exploding",
      tasksDone: 6,
      tasksTotal: 5,
      costUsd: -1,
      checks: "lint:maybe",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.map((problem) => problem.split(":")[0])).toEqual([
        "workstream",
        "branch",
        "updated",
        "status",
        "tasksDone",
        "costUsd",
        "checks",
      ]);
    }
  });
});

describe("parseChecks", () => {
  it("parses name:status pairs", () => {
    expect(parseChecks("typecheck:pass, test:pending")).toEqual([
      { name: "typecheck", status: "pass" },
      { name: "test", status: "pending" },
    ]);
  });

  it.each(["lint", "lint:ok", ":pass", "a:pass:x"])("rejects %j", (text) => {
    expect(parseChecks(text)).toBeNull();
  });
});

describe("writeSessionState", () => {
  it("creates a note with frontmatter and the three sections", async () => {
    const paths = vaultPaths(tmp());
    await writeSessionState(paths, STATE);
    const text = await readFile(join(paths.sessionsDir, "api.md"), "utf8");
    expect(text).toBe(renderSessionNote(STATE));
    expect(text).toContain("## Progress\n\n## Problems\n\n## Decisions\n");
  });

  it("updates frontmatter, keeping the body and extra keys a human added", async () => {
    const paths = vaultPaths(tmp());
    await writeSessionState(paths, STATE);
    const file = join(paths.sessionsDir, "api.md");
    const edited = (await readFile(file, "utf8"))
      .replace("---\nsession:", "---\naliases: api-session\nsession:")
      .replace("## Problems\n", "## Problems\n- hand-written note\n");
    await writeFile(file, edited);

    await writeSessionState(paths, { ...STATE, status: "checking", costUsd: 0.1 + 0.2 });
    const parsed = parseFrontmatter(await readFile(file, "utf8"));
    expect(parsed.data["aliases"]).toBe("api-session");
    expect(parsed.data["status"]).toBe("checking");
    expect(parsed.data["costUsd"]).toBe(0.3); // rounded to 4 decimals, no float noise
    expect(parsed.body).toContain("- hand-written note");
  });

  it("rejects session names that are not safe file names", async () => {
    await expect(
      writeSessionState(vaultPaths(tmp()), { ...STATE, session: "../escape" }),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_NAME" });
  });
});

describe("appendToSessionSection", () => {
  it("appends timestamped bullets to the right section in order", async () => {
    const paths = vaultPaths(tmp());
    await writeSessionState(paths, STATE);
    await appendToSessionSection(paths, "api", "Progress", "T1 done", localTime(1));
    await appendToSessionSection(paths, "api", "Problems", "lint keeps failing", localTime(2));
    await appendToSessionSection(paths, "api", "Progress", "T2 done", localTime(3));

    const { body } = parseFrontmatter(await readFile(join(paths.sessionsDir, "api.md"), "utf8"));
    expect(body).toContain(
      "## Progress\n- [2026-10-21 22:01] T1 done\n- [2026-10-21 22:03] T2 done\n\n## Problems\n" +
        "- [2026-10-21 22:02] lint keeps failing\n\n## Decisions\n",
    );
  });

  it("serializes concurrent appends to the same note", async () => {
    const paths = vaultPaths(tmp());
    await writeSessionState(paths, STATE);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendToSessionSection(paths, "api", "Progress", `step ${index}`, localTime()),
      ),
    );
    const text = await readFile(join(paths.sessionsDir, "api.md"), "utf8");
    expect(text.match(/\] step \d+/g)).toHaveLength(20);
  });

  it("fails clearly when the note does not exist", async () => {
    await expect(
      appendToSessionSection(vaultPaths(tmp()), "ghost", "Progress", "x", localTime()),
    ).rejects.toMatchObject({ code: "VAULT_NOT_FOUND" });
  });
});

describe("insertIntoSection", () => {
  it("creates a missing section at the end", () => {
    expect(insertIntoSection("# Title\n\n", "Problems", "- x")).toBe(
      "# Title\n\n## Problems\n- x\n",
    );
  });

  it("keeps a blank line before the next heading", () => {
    expect(insertIntoSection("## Progress\n## Problems\n", "Progress", "- x")).toBe(
      "## Progress\n- x\n\n## Problems\n",
    );
  });
});

describe("readSessionNotes", () => {
  it("returns [] when there is no sessions folder", async () => {
    expect(await readSessionNotes(vaultPaths(tmp()))).toEqual([]);
  });

  it("reads valid notes sorted by name and reports invalid ones", async () => {
    const paths = vaultPaths(tmp());
    await writeSessionState(paths, { ...STATE, session: "web" });
    await writeSessionState(paths, STATE);
    await mkdir(paths.sessionsDir, { recursive: true });
    await writeFile(join(paths.sessionsDir, "broken.md"), "---\nstatus: running\n---\n");
    await writeFile(
      join(paths.sessionsDir, "renamed.md"),
      renderSessionNote({ ...STATE, session: "other" }),
    );
    await writeFile(join(paths.sessionsDir, "Bad Name.md"), renderSessionNote(STATE));
    await writeFile(join(paths.sessionsDir, "notes.txt"), "ignored");

    const notes = await readSessionNotes(paths);
    expect(notes.map((note) => [note.name, note.result.ok])).toEqual([
      ["Bad Name", false],
      ["api", true],
      ["broken", false],
      ["renamed", false],
      ["web", true],
    ]);
  });
});
