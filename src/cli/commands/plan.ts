import { join, relative, resolve } from "node:path";
import { createAdapter } from "../../agents/create.js";
import { loadConfig } from "../../config/load.js";
import { errorCode, errorMessage, OrcError } from "../../core/errors.js";
import { readFileIfExists, writeFileAtomic } from "../../core/fs.js";
import { syncAppGuide } from "../../kit/install.js";
import { type AskQuestion, runPlanner } from "../../planner/planner.js";
import { loadPlannerPrompt } from "../../planner/prompts.js";
import { vaultPaths } from "../../vault/layout.js";
import {
  PLAN_FILES,
  type Plan,
  parsePlan,
  readPlanFiles,
  renderTaskGraph,
} from "../../vault/plan.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import type { CliIO } from "../io.js";
import { formatUsd } from "./status.js";

export const planCommand: Command = {
  name: "plan",
  summary: "Ask clarifying questions about an app idea, then write the plan into the vault",
  help: `Usage: orc plan <idea.md> [--force] [--defaults]
       orc plan --check

Reads your app idea, asks 10-15 clarifying questions, then writes the plan:
  plan/architecture.md      architecture and folder structure
  contracts/                DB schema, API types, shared types (before any coding)
  plan/agents.md            the target app's agents.md
  plan/setup.md             accounts, env vars, packages (you do the signups)
  plan/docs-needed.md       docs to paste into <vault>/docs/
  plan/workstreams/*.md     tasks, dependencies, owned files, definition of done
  plan/task-graph.md        generated overview
  plan/questions.md         your answers

Press Enter to accept the planner's suggested default for a question.
Every reply is validated before anything is written.

Options:
  --force       Replace an existing plan (removes the old plan/workstreams/)
  --defaults    Don't ask; accept every suggested default
  --check       Make no model call: validate the plan already in the vault (for a plan
                written by hand or by /orc-plan) with the parser "orc run" uses, and
                rewrite plan/task-graph.md. Exits 1 and lists every problem if invalid.
`,
  run: async (argv, io) => {
    const { values, positionals } = parseCommandArgs(argv, {
      force: { type: "boolean" },
      defaults: { type: "boolean" },
      check: { type: "boolean" },
    });
    if (values.check === true) {
      return checkPlan(positionals, values.config, io);
    }
    const [ideaArg, ...extra] = positionals;
    if (ideaArg === undefined || extra.length > 0) {
      throw new OrcError("USAGE", 'expected exactly one idea file. Run "orc plan --help".');
    }

    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const ideaPath = resolve(io.cwd, ideaArg);
    const idea = await readIdea(ideaPath);
    const systemPrompt = await loadPlannerPrompt();
    const adapter = await createAdapter(loaded, io.env);
    const asker = values.defaults === true ? acceptDefaults() : askInTerminal(io);

    try {
      const result = await runPlanner({
        adapter,
        config: loaded.config,
        rootDir: loaded.rootDir,
        vault: vaultPaths(loaded.vaultPath),
        idea: { file: relative(loaded.rootDir, ideaPath), text: idea },
        systemPrompt,
        ask: asker.ask,
        now: io.now,
        force: values.force === true,
        onProgress: (message) => io.stdout(`${message}\n`),
      });

      for (const warning of [...result.warnings, ...asker.notes()]) {
        io.stderr(`orc: warning: ${warning}\n`);
      }
      await copyGuide(loaded.rootDir, loaded.vaultPath, io);
      const workstreams = describeWorkstreams(result.plan);
      io.stdout(
        `\nPlan written to ${loaded.vaultPath}:\n` +
          result.written.map((path) => `  ${path}\n`).join("") +
          `\nWorkstreams: ${workstreams.join("; ")}\n` +
          `Planner: ${result.turns} turns, ${formatUsd(result.costUsd)} ` +
          "(Agent SDK estimate, not billing data)\n" +
          "\nNext: create the accounts in plan/setup.md, paste the docs listed in " +
          "plan/docs-needed.md, then run: orc check-setup\n",
      );
      return 0;
    } finally {
      await adapter.close();
    }
  },
};

/** Copies plan/agents.md into AGENTS.md at the repo root (between marker comments). */
async function copyGuide(rootDir: string, vaultRoot: string, io: CliIO): Promise<void> {
  const guide = await readFileIfExists(join(vaultRoot, PLAN_FILES.agents));
  if (guide === null || guide.trim() === "") {
    return;
  }
  const result = await syncAppGuide(rootDir, guide);
  if (result.action !== "unchanged") {
    io.stdout(
      `${result.action === "created" ? "Created" : "Updated"} AGENTS.md with the app's guide (plan/agents.md)\n`,
    );
  }
}

function describeWorkstreams(plan: Plan): string[] {
  return plan.workstreams.map((ws) => {
    const waits = ws.dependsOn.length === 0 ? "" : `, waits on ${ws.dependsOn.join(", ")}`;
    return `${ws.name} (${ws.tasks.length} task${ws.tasks.length === 1 ? "" : "s"}${waits})`;
  });
}

async function checkPlan(
  positionals: readonly string[],
  configPath: string | undefined,
  io: CliIO,
): Promise<number> {
  if (positionals.length > 0) {
    throw new OrcError("USAGE", '--check takes no idea file. Run "orc plan --help".');
  }
  const loaded = await loadConfig({ cwd: io.cwd, path: configPath });
  const vault = vaultPaths(loaded.vaultPath);
  const parsed = parsePlan(await readPlanFiles(vault));
  if (!parsed.ok) {
    throw new OrcError(
      "PLAN_INVALID",
      `the plan in ${loaded.vaultPath} has ${parsed.issues.length} problem${parsed.issues.length === 1 ? "" : "s"}:`,
      parsed.issues,
    );
  }
  await writeFileAtomic(join(vault.root, PLAN_FILES.taskGraph), renderTaskGraph(parsed.value));
  await copyGuide(loaded.rootDir, vault.root, io);
  io.stdout(
    `Plan OK: ${describeWorkstreams(parsed.value).join("; ")}\n` +
      `${parsed.value.contracts.length} contract file(s); wrote ${PLAN_FILES.taskGraph}\n`,
  );
  return 0;
}

async function readIdea(path: string): Promise<string> {
  let text: string | null;
  try {
    text = await readFileIfExists(path);
  } catch (error) {
    const reason = errorCode(error) === "EISDIR" ? "it is a directory" : errorMessage(error);
    throw new OrcError("IDEA_NOT_FOUND", `cannot read idea file ${path}: ${reason}`);
  }
  if (text === null) {
    throw new OrcError("IDEA_NOT_FOUND", `idea file not found: ${path}`);
  }
  if (text.trim() === "") {
    throw new OrcError("IDEA_NOT_FOUND", `idea file is empty: ${path}`);
  }
  return text;
}

interface Asker {
  readonly ask: AskQuestion;
  /** Notes for the user after planning, e.g. that input ended early. */
  readonly notes: () => string[];
}

function acceptDefaults(): Asker {
  return { ask: async () => null, notes: () => [] };
}

function askInTerminal(io: CliIO): Asker {
  let ended = 0;
  return {
    ask: async (question, index, total) => {
      const why = question.why === "" ? "" : `  Why: ${question.why}\n`;
      const fallback =
        question.default === "" ? "  No default: Enter lets the planner decide\n" : "";
      const suggested =
        question.default === "" ? "" : `  Default: ${question.default} (press Enter to accept)\n`;
      io.stdout(
        `\nQuestion ${index + 1}/${total}: ${question.question}\n${why}${suggested}${fallback}`,
      );
      if (ended > 0) {
        ended += 1;
        io.stdout("> (no input; using the default)\n");
        return null;
      }
      const line = await io.readLine("> ");
      if (line === null) {
        ended = 1;
        io.stdout("(no input; using the default)\n");
      }
      return line;
    },
    notes: () =>
      ended === 0
        ? []
        : [`input ended early: the planner's defaults were used for ${ended} question(s)`],
  };
}
