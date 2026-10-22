import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { writeFileAtomic } from "../core/fs.js";
import { parseFileBlocks } from "../planner/protocol.js";
import { vaultPaths } from "./layout.js";
import {
  markdownSections,
  markTaskDone,
  markTasksUndoneFrom,
  PLAN_FILES,
  parseDocsNeeded,
  parsePlan,
  parseSetup,
  parseWorkstream,
  readPlanFiles,
  renderTaskGraph,
  validateTaskGraph,
  type Workstream,
} from "./plan.js";

const REPLY = fileURLToPath(new URL("../../test/fixtures/planner/plan-reply.md", import.meta.url));
const tmp = useTmpDir("orc-plan-");

async function fixtureFiles(): Promise<Map<string, string>> {
  const parsed = parseFileBlocks(await readFile(REPLY, "utf8"));
  if (!parsed.ok) {
    throw new Error(parsed.issues.join("\n"));
  }
  return new Map(parsed.value);
}

function workstream(name: string, tasks: string, owns = `- \`src/${name}/**\``): string {
  return `# Workstream: ${name}\n\n## Goal\nDo ${name}.\n\n## Owns\n${owns}\n\n## Tasks\n${tasks}\n\n## Definition of done\n- checks pass\n`;
}

function parsedWorkstream(name: string, tasks: string, owns?: string): Workstream {
  const result = parseWorkstream(name, workstream(name, tasks, owns));
  if (!result.ok) {
    throw new Error(result.issues.join("\n"));
  }
  return result.value;
}

describe("markdownSections", () => {
  it("splits on ## headings and ignores headings inside code fences", () => {
    const sections = markdownSections("# T\n## One\na\n```\n## not\n```\n## Two ##\nb\n");
    expect([...sections.keys()]).toEqual(["one", "two"]);
    expect(sections.get("one")).toEqual(["a", "```", "## not", "```"]);
  });
});

describe("parseSetup", () => {
  it("reads env vars with purpose and the optional marker", () => {
    const result = parseSetup(
      "## Accounts\n- [ ] `NOT_AN_ENV`: ignored here\n\n## Env vars\n- `DB_URL`: Postgres URL\n- `SENTRY_DSN` — Sentry (optional)\n  - nested note is ignored\n",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { name: "DB_URL", purpose: "Postgres URL", optional: false },
        { name: "SENTRY_DSN", purpose: "Sentry", optional: true },
      ],
    });
  });

  it("accepts '- None' and reports a missing section or a malformed bullet", () => {
    expect(parseSetup("## Env vars\n- None\n")).toEqual({ ok: true, value: [] });
    expect(parseSetup("# Setup\n")).toEqual({
      ok: false,
      issues: ['plan/setup.md: missing "## Env vars" section'],
    });
    const bad = parseSetup("## Env vars\n- DB_URL: no backticks\n- `DB_URL`: x\n- `DB_URL`: y\n");
    expect(bad.ok ? [] : bad.issues).toEqual([
      'plan/setup.md: env var bullet must start with `NAME`: "DB_URL: no backticks"',
      "plan/setup.md: env var DB_URL is listed twice",
    ]);
  });
});

describe("parseDocsNeeded", () => {
  it("reads doc file names and descriptions", () => {
    expect(parseDocsNeeded("## Docs\n- `clerk.md`: Clerk v6 (https://clerk.com)\n")).toEqual({
      ok: true,
      value: [{ file: "clerk.md", description: "Clerk v6 (https://clerk.com)" }],
    });
  });

  it("rejects names that are not lowercase .md files", () => {
    const result = parseDocsNeeded("## Docs\n- `Clerk.txt`: no\n");
    expect(result.ok).toBe(false);
  });
});

describe("parseWorkstream", () => {
  it("parses goal, owns, tasks with needs and done state, and derives dependsOn", () => {
    const ws = parsedWorkstream(
      "web",
      "- [x] T1: Scaffold\n- [ ] T2: List page (needs: api/T2, T1)\n- [ ] T3: Filters (needs: db/T1)",
    );
    expect(ws.goal).toBe("Do web.");
    expect(ws.owns).toEqual(["src/web/**"]);
    expect(ws.tasks).toEqual([
      { id: "T1", ref: "web/T1", title: "Scaffold", needs: [], done: true },
      { id: "T2", ref: "web/T2", title: "List page", needs: ["api/T2", "web/T1"], done: false },
      { id: "T3", ref: "web/T3", title: "Filters", needs: ["db/T1"], done: false },
    ]);
    expect(ws.dependsOn).toEqual(["api", "db"]);
  });

  it("reports every structural problem", () => {
    const result = parseWorkstream(
      "Bad_Name",
      "## Goal\n\n## Tasks\n- do stuff\n- T1: x\n- T1: y\n",
    );
    expect(result.ok ? [] : result.issues).toEqual([
      "plan/workstreams/Bad_Name.md: workstream names must be lowercase kebab-case (they become branches)",
      'plan/workstreams/Bad_Name.md: missing "## Owns" section',
      'plan/workstreams/Bad_Name.md: missing "## Definition of done" section',
      'plan/workstreams/Bad_Name.md: "## Goal" is empty',
      'plan/workstreams/Bad_Name.md: task must look like "- [ ] T1: title (needs: ws/T2)": "do stuff"',
      "plan/workstreams/Bad_Name.md: task id T1 is used twice",
    ]);
  });
});

describe("validateTaskGraph", () => {
  it("accepts a graph with cross-workstream needs", () => {
    const api = parsedWorkstream("api", "- [ ] T1: a (needs: web/T1)\n- [ ] T2: b");
    const web = parsedWorkstream("web", "- [ ] T1: c\n- [ ] T2: d (needs: api/T2)");
    expect(validateTaskGraph([api, web])).toEqual([]);
  });

  it("reports unknown needs, cycles and shared ownership", () => {
    const api = parsedWorkstream(
      "api",
      "- [ ] T1: a (needs: web/T2)\n- [ ] T2: b (needs: web/T9)",
      "- `src/shared/**`",
    );
    const web = parsedWorkstream(
      "web",
      "- [ ] T1: c\n- [ ] T2: d (needs: api/T1)",
      "- `src/shared/**`",
    );
    expect(validateTaskGraph([api, web])).toEqual([
      "api/T2 needs web/T9, which does not exist",
      "task dependencies form a cycle: api/T1 → web/T2 → api/T1",
      '"src/shared/**" is owned by both api and web',
    ]);
  });
});

describe("parsePlan", () => {
  it("accepts the fixture plan", async () => {
    const result = parsePlan(await fixtureFiles());
    if (!result.ok) {
      throw new Error(result.issues.join("\n"));
    }
    expect(result.value.workstreams.map((ws) => ws.name)).toEqual(["api", "web"]);
    expect(result.value.workstreams[0]?.dependsOn).toEqual(["web"]);
    expect(result.value.envVars.map((env) => env.name)).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SENTRY_DSN",
    ]);
    expect(result.value.docs.map((doc) => doc.file)).toEqual(["supabase.md", "nextjs.md"]);
    expect(result.value.contracts).toEqual(["contracts/db-schema.sql", "contracts/types.ts"]);
  });

  it("lists every missing piece of an empty plan", () => {
    const result = parsePlan(new Map());
    expect(result.ok ? [] : result.issues).toEqual([
      "plan/architecture.md: missing or empty",
      "plan/agents.md: missing or empty",
      "plan/setup.md: missing or empty",
      "plan/docs-needed.md: missing or empty",
      "plan/workstreams/: at least one workstream is required",
      "contracts/: at least one contract file is required",
    ]);
  });

  it("rejects nested workstream paths", async () => {
    const files = await fixtureFiles();
    files.set("plan/workstreams/extra/x.md", "x");
    const result = parsePlan(files);
    expect(result.ok ? [] : result.issues).toEqual([
      "plan/workstreams/extra/x.md: workstream notes must be plan/workstreams/<name>.md",
    ]);
  });
});

describe("readPlanFiles", () => {
  it("round-trips the plan through the vault, skipping dotfiles", async () => {
    const paths = vaultPaths(join(tmp(), "vault"));
    const files = await fixtureFiles();
    for (const [path, content] of files) {
      await writeFileAtomic(join(paths.root, path), content);
    }
    await writeFileAtomic(join(paths.planDir, ".DS_Store"), "junk");
    expect(await readPlanFiles(paths)).toEqual(files);
  });

  it("returns an empty map when there is no plan", async () => {
    expect((await readPlanFiles(vaultPaths(join(tmp(), "none")))).size).toBe(0);
  });
});

describe("renderTaskGraph", () => {
  it("renders a table and a mermaid flowchart with sequence and needs edges", async () => {
    const result = parsePlan(await fixtureFiles());
    if (!result.ok) {
      throw new Error("fixture should parse");
    }
    const note = renderTaskGraph(result.value);
    expect(note).toContain(`| [[${PLAN_FILES.workstreamsDir}/api\\|api]] | 0/2 | web |`);
    expect(note).toContain(
      '    web__T1["T1: Scaffold Next.js 15 with Tailwind, Vitest, lint and the four npm scripts"]',
    );
    expect(note).toContain("    web__T1 --> web__T2");
    expect(note).toContain("  web__T1 --> api__T1");
    expect(note).toContain("  api__T2 --> web__T3");
  });
});

describe("markTaskDone", () => {
  const note =
    "# Workstream: api\n\n## Goal\nx\n\n## Owns\n- `src/**`\n\n## Tasks\n- [ ] T1: First\n- [ ] T2: Second (needs: db/T1)\n- [x] T3: Third\n\n## Definition of done\n- [ ] T1: not a task\n";

  async function setup(): Promise<{ paths: ReturnType<typeof vaultPaths>; file: string }> {
    const paths = vaultPaths(tmp());
    const file = join(paths.planDir, "workstreams", "api.md");
    await writeFileAtomic(file, note);
    return { paths, file };
  }

  it("ticks only the named task in the Tasks section", async () => {
    const { paths, file } = await setup();
    expect(await markTaskDone(paths, "api", "T2")).toBe(true);
    const text = await readFile(file, "utf8");
    expect(text).toContain("- [ ] T1: First\n- [x] T2: Second (needs: db/T1)\n- [x] T3: Third");
    expect(text).toContain("## Definition of done\n- [ ] T1: not a task");
  });

  it("still parses afterwards, with the task marked done", async () => {
    const { paths, file } = await setup();
    await markTaskDone(paths, "api", "T1");
    const parsed = parseWorkstream("api", await readFile(file, "utf8"));
    expect(parsed.ok && parsed.value.tasks.map((t) => t.done)).toEqual([true, false, true]);
  });

  it("returns false for a task that is missing or already ticked, and for a missing note", async () => {
    const { paths } = await setup();
    expect(await markTaskDone(paths, "api", "T3")).toBe(false);
    expect(await markTaskDone(paths, "api", "T9")).toBe(false);
    expect(await markTaskDone(paths, "nope", "T1")).toBe(false);
  });

  it("keeps concurrent ticks from overwriting each other", async () => {
    const { paths, file } = await setup();
    await writeFile(file, note);
    await Promise.all([markTaskDone(paths, "api", "T1"), markTaskDone(paths, "api", "T2")]);
    const text = await readFile(file, "utf8");
    expect(text).toContain("- [x] T1: First");
    expect(text).toContain("- [x] T2: Second");
  });
});

describe("markTasksUndoneFrom", () => {
  const note =
    "# Workstream: api\n\n## Goal\nx\n\n## Owns\n- `src/**`\n\n## Tasks\n- [x] T1: First\n- [x] T2: Second\n- [ ] T3: Third\n- [x] T4: Fourth\n\n## Definition of done\n- [x] T2: not a task\n";

  it("unticks the named task and every ticked task after it, and nothing else", async () => {
    const paths = vaultPaths(tmp());
    const file = join(paths.planDir, "workstreams", "api.md");
    await writeFileAtomic(file, note);

    expect(await markTasksUndoneFrom(paths, "api", "T2")).toEqual(["T2", "T4"]);

    const text = await readFile(file, "utf8");
    expect(text).toContain("- [x] T1: First\n- [ ] T2: Second\n- [ ] T3: Third\n- [ ] T4: Fourth");
    expect(text).toContain("## Definition of done\n- [x] T2: not a task");
  });

  it("returns nothing for a missing task or note", async () => {
    const paths = vaultPaths(tmp());
    await writeFileAtomic(join(paths.planDir, "workstreams", "api.md"), note);
    expect(await markTasksUndoneFrom(paths, "api", "T9")).toEqual([]);
    expect(await markTasksUndoneFrom(paths, "nope", "T1")).toEqual([]);
  });
});

describe("reserved workstream names", () => {
  it("rejects names orc uses for itself", () => {
    const text =
      "# Workstream\n\n## Goal\nx\n\n## Owns\n- `src/**`\n\n## Tasks\n- [ ] T1: a\n\n## Definition of done\n- ok\n";
    for (const name of ["orc", "integration"]) {
      const result = parseWorkstream(name, text);
      expect(!result.ok && result.issues[0]).toContain("reserved for orc itself");
    }
  });
});
