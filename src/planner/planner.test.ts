import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localTime, useTmpDir } from "../../test/helpers/tmp-dir.js";
import { FakeAgentAdapter, type FakeTurn } from "../agents/fake.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { OrcConfig } from "../config/types.js";
import { OrcError } from "../core/errors.js";
import { readFileIfExists, writeFileAtomic } from "../core/fs.js";
import { vaultPaths } from "../vault/layout.js";
import { readLogTail } from "../vault/log.js";
import { type AskQuestion, type RunPlannerOptions, runPlanner } from "./planner.js";

const FIXTURES = fileURLToPath(new URL("../../test/fixtures/planner/", import.meta.url));
const tmp = useTmpDir("orc-planner-");

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

async function scriptedTurns(): Promise<FakeTurn[]> {
  return [
    { expect: "Phase 1", text: await fixture("questions-reply.md"), costUsd: 0.04 },
    { expect: "Phase 2", text: await fixture("plan-reply.md"), costUsd: 0.31 },
  ];
}

function questionsJson(count: number): string {
  const questions = Array.from({ length: count }, (_, i) => ({
    question: `Q${i + 1}?`,
    default: `d${i + 1}`,
  }));
  return `\`\`\`json\n${JSON.stringify({ questions })}\n\`\`\``;
}

/** Answers the first question, leaves the rest to the planner's defaults. */
const answerFirstOnly: AskQuestion = async (_question, index) => (index === 0 ? "Remix" : null);

function options(
  adapter: FakeAgentAdapter,
  overrides: Omit<Partial<RunPlannerOptions>, "config"> & { config?: Partial<OrcConfig> } = {},
): RunPlannerOptions {
  const { config, ...rest } = overrides;
  return {
    adapter,
    config: { ...DEFAULT_CONFIG, ...config },
    rootDir: tmp(),
    vault: vaultPaths(join(tmp(), "vault")),
    idea: { file: "idea.md", text: "A todo app." },
    systemPrompt: "SYSTEM PROMPT",
    ask: answerFirstOnly,
    now: () => localTime(5),
    force: false,
    ...rest,
  };
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

describe("runPlanner", () => {
  it("asks questions, then writes a validated plan from the same session", async () => {
    const fake = new FakeAgentAdapter({ turns: await scriptedTurns() });
    const opts = options(fake);
    const result = await runPlanner(opts);

    // Two turns: a new session, then a resume of it, both read-only with the planner model.
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]).toMatchObject({
      cwd: tmp(),
      model: DEFAULT_CONFIG.planner.model,
      access: "read-only",
      systemPrompt: "SYSTEM PROMPT",
      resumeSessionId: undefined,
      maxBudgetUsd: 20,
    });
    expect(fake.requests[0]?.prompt).toContain("A todo app.");
    expect(fake.requests[1]?.resumeSessionId).toBe("fake-session-1");
    expect(fake.requests[1]?.maxBudgetUsd).toBeCloseTo(19.96);
    expect(fake.requests[1]?.prompt).toContain("1. Which frontend framework?\n   Answer: Remix\n");
    expect(fake.requests[1]?.prompt).toContain(
      "   Answer: Postgres on Supabase (your default; the user had no preference)",
    );
    expect(fake.requests[1]?.prompt).toContain("- typecheck: `npm run typecheck`");

    expect(result).toMatchObject({ costUsd: 0.35, turns: 2, sessionId: "fake-session-1" });
    expect(result.warnings).toEqual([]);
    expect(result.plan.workstreams.map((ws) => ws.name)).toEqual(["api", "web"]);
    expect(result.written).toEqual([
      "plan/questions.md",
      "plan/architecture.md",
      "plan/agents.md",
      "plan/setup.md",
      "plan/docs-needed.md",
      "contracts/types.ts",
      "contracts/db-schema.sql",
      "plan/workstreams/api.md",
      "plan/workstreams/web.md",
      "plan/task-graph.md",
    ]);

    const vault = opts.vault;
    const questions = await readFile(join(vault.planDir, "questions.md"), "utf8");
    expect(questions).toContain('tags: [plan]\nidea: "idea.md"\nasked: "2026-10-21 22:05"');
    expect(questions).toContain(
      "## 1. Which frontend framework?\n*Why:* Shapes the folder structure and routing.\n**Answer:** Remix\n",
    );
    expect(questions).toContain("**Answer:** Postgres on Supabase *(planner default)*");
    expect(await readFile(join(vault.root, "contracts/types.ts"), "utf8")).toContain(
      "export interface Todo",
    );
    expect(await readFile(join(vault.planDir, "task-graph.md"), "utf8")).toContain("```mermaid");
    // ensureVault seeded the rest of the vault.
    expect(await readFileIfExists(vault.decisions)).not.toBeNull();

    const log = await readLogTail(vault, 5);
    expect(log).toEqual([
      {
        time: "2026-10-21 22:05",
        session: "planner",
        did: "wrote plan: 2 workstreams, 5 tasks, 2 contracts (2 turns, ~$0.35 est.)",
        touching: ["plan/", "contracts/"],
      },
    ]);
  });

  it("includes the vault's rules in the questions prompt", async () => {
    const fake = new FakeAgentAdapter({ turns: await scriptedTurns() });
    const opts = options(fake);
    await writeFileAtomic(opts.vault.rules, "# Rules\n- Use pnpm, never npm.\n");
    await runPlanner(opts);
    expect(fake.requests[0]?.prompt).toContain("- Use pnpm, never npm.");
  });

  it("sends a repair turn listing the problems, then accepts the fixed plan", async () => {
    const [questions, plan] = await scriptedTurns();
    if (questions === undefined || plan === undefined) {
      throw new Error("fixture turns missing");
    }
    const broken = '<<<orc-file path="plan/setup.md">>>\n## Env vars\n- None\n<<<orc-end>>>\n';
    const fake = new FakeAgentAdapter({
      turns: [questions, { text: broken, costUsd: 0.1 }, { ...plan, expect: "could not use" }],
    });
    const result = await runPlanner(options(fake));

    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[2]?.resumeSessionId).toBe("fake-session-1");
    expect(fake.requests[2]?.prompt).toContain("- plan/architecture.md: missing or empty");
    expect(fake.requests[2]?.prompt).toContain("Send the complete, corrected set of files again");
    expect(result.turns).toBe(3);
    expect(result.costUsd).toBe(0.45);
  });

  it("gives up after retries.maxPerTask repairs and writes only the answers", async () => {
    const fake = new FakeAgentAdapter({
      turns: [{ text: questionsJson(10) }, { text: "no files" }, { text: "still no files" }],
    });
    const opts = options(fake, { config: { retries: { maxPerTask: 1 } } });
    const error = await rejection(runPlanner(opts));

    expect(error.code).toBe("PLAN_INVALID");
    expect(error.message).toContain("after 1 repair attempt(s)");
    expect(error.details).toEqual(["the reply contains no <<<orc-file>>> blocks"]);
    expect(await readFileIfExists(join(opts.vault.planDir, "questions.md"))).not.toBeNull();
    expect(await readFileIfExists(join(opts.vault.planDir, "architecture.md"))).toBeNull();
  });

  it("repairs malformed questions too", async () => {
    const [questions, plan] = await scriptedTurns();
    if (questions === undefined || plan === undefined) {
      throw new Error("fixture turns missing");
    }
    const fake = new FakeAgentAdapter({
      turns: [{ text: "Let me think." }, { ...questions, expect: "could not use" }, plan],
    });
    const result = await runPlanner(options(fake));
    expect(fake.requests[1]?.prompt).toContain("Send the questions again.");
    expect(result.turns).toBe(3);
  });

  it("warns when the planner asks fewer than 10 questions", async () => {
    const [, plan] = await scriptedTurns();
    if (plan === undefined) {
      throw new Error("fixture turns missing");
    }
    const fake = new FakeAgentAdapter({ turns: [{ text: questionsJson(3) }, plan] });
    const result = await runPlanner(options(fake));
    expect(result.warnings).toEqual(["the planner asked 3 questions (expected 10-15)"]);
    expect(result.answers.map((a) => a.answer)).toEqual(["Remix", "d2", "d3"]);
  });

  it("refuses to overwrite a plan without --force, before any model call", async () => {
    const fake = new FakeAgentAdapter({ turns: await scriptedTurns() });
    const opts = options(fake);
    await writeFileAtomic(join(opts.vault.planDir, "workstreams", "old.md"), "# old\n");
    expect((await rejection(runPlanner(opts))).code).toBe("PLAN_EXISTS");
    expect(fake.requests).toHaveLength(0);
  });

  it("allows a re-run when only questions.md is left from a failed attempt", async () => {
    const opts = options(new FakeAgentAdapter({ turns: await scriptedTurns() }));
    await writeFileAtomic(join(opts.vault.planDir, "questions.md"), "# old answers\n");
    await expect(runPlanner(opts)).resolves.toMatchObject({ turns: 2 });
  });

  it("with --force, replaces the plan and removes stale workstreams", async () => {
    const opts = options(new FakeAgentAdapter({ turns: await scriptedTurns() }), { force: true });
    const stale = join(opts.vault.planDir, "workstreams", "old.md");
    await writeFileAtomic(stale, "# old\n");
    await runPlanner(opts);
    expect(await readFileIfExists(stale)).toBeNull();
    expect(
      await readFileIfExists(join(opts.vault.planDir, "workstreams", "web.md")),
    ).not.toBeNull();
  });

  it("stops when the run cap is used up before the next turn", async () => {
    const [questions] = await scriptedTurns();
    if (questions === undefined) {
      throw new Error("fixture turns missing");
    }
    const fake = new FakeAgentAdapter({ turns: [{ ...questions, costUsd: 1 }] });
    const error = await rejection(runPlanner(options(fake, { config: { maxBudgetUsd: 1 } })));
    expect(error.code).toBe("BUDGET_EXCEEDED");
    expect(error.message).toContain("~$1.00 of $1.00");
    expect(fake.requests).toHaveLength(1);
  });

  it("maps a max_budget outcome to BUDGET_EXCEEDED and other failures to AGENT_FAILED", async () => {
    const budget = new FakeAgentAdapter({
      turns: [{ text: "", outcome: "max_budget", costUsd: 2 }],
    });
    expect((await rejection(runPlanner(options(budget)))).code).toBe("BUDGET_EXCEEDED");

    const failed = new FakeAgentAdapter({
      turns: [{ text: "", outcome: "error", errors: ["authentication_failed"] }],
    });
    const error = await rejection(runPlanner(options(failed)));
    expect(error.code).toBe("AGENT_FAILED");
    expect(error.details).toEqual(["authentication_failed"]);
  });

  it("reports tool events as progress", async () => {
    const turns = await scriptedTurns();
    const [questions, plan] = turns;
    if (questions === undefined || plan === undefined) {
      throw new Error("fixture turns missing");
    }
    const fake = new FakeAgentAdapter({
      turns: [{ ...questions, events: [{ type: "tool", name: "Read" }] }, plan],
    });
    const messages: string[] = [];
    await runPlanner(options(fake, { onProgress: (m) => messages.push(m) }));
    expect(messages).toEqual([
      "Asking the planner for clarifying questions…",
      "  · Read",
      "Writing the plan…",
    ]);
  });

  it("keeps the idea file text out of the vault", async () => {
    const opts = options(new FakeAgentAdapter({ turns: await scriptedTurns() }));
    await writeFile(join(tmp(), "idea.md"), "secret idea");
    await runPlanner(opts);
    expect(await readFileIfExists(join(opts.vault.planDir, "idea.md"))).toBeNull();
  });
});
