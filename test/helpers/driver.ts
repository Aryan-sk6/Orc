import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentAdapter, AgentTurnRequest, AgentTurnResult } from "../../src/agents/adapter.js";
import { FakeAgentAdapter, type FakeTurn } from "../../src/agents/fake.js";
import { resolveConfig } from "../../src/config/load.js";
import type { OrcConfig, OrcConfigInput } from "../../src/config/types.js";
import { writeFileAtomic } from "../../src/core/fs.js";
import type { Env } from "../../src/git/git.js";
import { openRepo, type Repo } from "../../src/git/worktrees.js";
import { ensureVault } from "../../src/vault/init.js";
import { type VaultPaths, vaultPaths } from "../../src/vault/layout.js";
import { type Plan, parsePlan, readPlanFiles } from "../../src/vault/plan.js";
import { gitTestEnv, initRepo } from "./git.js";

export const MARKER_CHECK = { name: "marker", command: "test -f ok.txt", timeoutMs: 20_000 };
export const AGENTS_MD_TEXT = "Use tabs. Never edit contracts.";
export const CONTRACT_TEXT = "export interface Todo { id: string }";

export interface App {
  readonly dir: string;
  readonly root: string;
  readonly env: Env;
  readonly repo: Repo;
  readonly vault: VaultPaths;
  readonly plan: Plan;
}

/** Workstream name → task bullets, e.g. `- [ ] T1: Add the route`. */
export type WorkstreamTasks = Readonly<Record<string, string>>;

/** A temp git repo with an empty-but-valid plan in its (untracked) vault. */
export async function setupApp(dir: string, workstreams: WorkstreamTasks): Promise<App> {
  const env = gitTestEnv(dir);
  const root = join(dir, "app");
  await initRepo(root, env);
  const vault = vaultPaths(join(root, "vault"));
  await ensureVault(vault);
  const write = (path: string, content: string): Promise<void> =>
    writeFileAtomic(join(vault.root, ...path.split("/")), content);

  await write("plan/architecture.md", "# Architecture\n\nA small app.\n");
  await write("plan/agents.md", `# agents.md\n\n${AGENTS_MD_TEXT}\n`);
  await write("plan/setup.md", "# Setup\n\n## Env vars\n- None\n");
  await write("plan/docs-needed.md", "# Docs\n\n## Docs\n- None\n");
  await write("contracts/types.ts", `${CONTRACT_TEXT}\n`);
  for (const [name, tasks] of Object.entries(workstreams)) {
    await write(
      `plan/workstreams/${name}.md`,
      `# Workstream: ${name}\n\n## Goal\nBuild ${name}.\n\n## Owns\n- \`src/${name}/**\`\n\n## Tasks\n${tasks}\n\n## Definition of done\n- checks pass\n`,
    );
  }
  const parsed = parsePlan(await readPlanFiles(vault));
  if (!parsed.ok) {
    throw new Error(parsed.issues.join("\n"));
  }
  return { dir, root, env, repo: await openRepo(root, env), vault, plan: parsed.value };
}

export function testConfig(input: OrcConfigInput = {}): OrcConfig {
  return resolveConfig({ adapter: "fake", checks: [MARKER_CHECK], ...input });
}

export async function reloadPlan(app: App): Promise<Plan> {
  const parsed = parsePlan(await readPlanFiles(app.vault));
  if (!parsed.ok) {
    throw new Error(parsed.issues.join("\n"));
  }
  return parsed.value;
}

export function tasks(...titles: string[]): string {
  return titles.map((title, index) => `- [ ] T${index + 1}: ${title}`).join("\n");
}

export const fixReply = (prompt: string): string =>
  `\`\`\`json\n${JSON.stringify({ action: "fix", prompt })}\n\`\`\``;

export const escalateReply = (
  question: string,
  defaultTaken: string | null,
  reversible: boolean,
): string =>
  `\`\`\`json\n${JSON.stringify({ action: "escalate", question, default: defaultTaken, reversible })}\n\`\`\``;

/**
 * Sends each workstream's turns to its own FakeAgentAdapter (chosen by worktree folder name), so
 * sessions running in parallel stay deterministic. `onTurn` plays the part of the coding agent
 * editing files in `request.cwd`.
 */
export class RoutedAdapter implements AgentAdapter {
  readonly name = "routed";
  private readonly routes = new Map<string, FakeAgentAdapter>();

  constructor(
    scripts: Readonly<Record<string, readonly FakeTurn[]>>,
    private readonly onTurn: (
      request: AgentTurnRequest,
      workstream: string,
    ) => Promise<void> | void = () => undefined,
  ) {
    for (const [workstream, turns] of Object.entries(scripts)) {
      this.routes.set(workstream, new FakeAgentAdapter({ turns }));
    }
  }

  route(workstream: string): FakeAgentAdapter {
    const found = this.routes.get(workstream);
    if (found === undefined) {
      throw new Error(`no scripted turns for workstream ${workstream}`);
    }
    return found;
  }

  async runTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const workstream = basename(request.cwd);
    await this.onTurn(request, workstream);
    return this.route(workstream).runTurn(request);
  }

  async close(): Promise<void> {
    await Promise.all([...this.routes.values()].map((fake) => fake.close()));
  }
}

/** The usual "agent": creates ok.txt (so the marker check passes) unless the prompt says otherwise. */
export async function writeMarker(request: AgentTurnRequest): Promise<void> {
  if (request.access === "edit") {
    await writeFile(join(request.cwd, "ok.txt"), "ok\n");
  }
}
