import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { errorCode } from "../core/errors.js";
import { readFileIfExists } from "../core/fs.js";
import { isValidSessionName, VAULT_LAYOUT, type VaultPaths } from "./layout.js";

/*
 * The plan lives in the target vault as plain markdown, editable in Obsidian.
 * A few strict conventions make the parts orc acts on machine-readable:
 *
 *   plan/setup.md          "## Env vars" bullets:  - `NAME`: purpose (optional)
 *   plan/docs-needed.md    "## Docs" bullets:      - `clerk.md`: what to paste, source URL
 *   plan/workstreams/<name>.md
 *                          "## Goal" text, "## Owns" bullets, "## Definition of done" bullets,
 *                          "## Tasks" bullets:     - [ ] T1: title (needs: other-ws/T2)
 *
 * Tasks in one workstream run in order; `needs:` adds cross-workstream dependencies.
 * Markdown is the only source of truth: there is no JSON copy of the plan.
 */

const PLAN = VAULT_LAYOUT.planDir;

/** Vault-relative plan paths (always "/"-separated). */
export const PLAN_FILES = {
  architecture: `${PLAN}/architecture.md`,
  agents: `${PLAN}/agents.md`,
  setup: `${PLAN}/setup.md`,
  docsNeeded: `${PLAN}/docs-needed.md`,
  questions: `${PLAN}/questions.md`,
  taskGraph: `${PLAN}/task-graph.md`,
  workstreamsDir: `${PLAN}/workstreams`,
  contractsDir: VAULT_LAYOUT.contractsDir,
} as const;

/** Files the planner model must write. `questions.md` and `task-graph.md` are written by orc. */
export const PLANNER_WRITTEN_FILES: readonly string[] = [
  PLAN_FILES.architecture,
  PLAN_FILES.agents,
  PLAN_FILES.setup,
  PLAN_FILES.docsNeeded,
];

export interface EnvVarRequirement {
  readonly name: string;
  readonly purpose: string;
  readonly optional: boolean;
}

export interface DocRequirement {
  /** File name expected in the vault's docs/ folder, e.g. "clerk.md". */
  readonly file: string;
  readonly description: string;
}

export interface PlanTask {
  /** "T1", unique within its workstream. */
  readonly id: string;
  /** "<workstream>/<id>", unique across the plan. */
  readonly ref: string;
  readonly title: string;
  /** Refs of tasks in other workstreams that must finish first. */
  readonly needs: readonly string[];
  readonly done: boolean;
}

export interface Workstream {
  readonly name: string;
  readonly goal: string;
  readonly owns: readonly string[];
  readonly tasks: readonly PlanTask[];
  readonly definitionOfDone: readonly string[];
  /** Other workstreams this one waits on, derived from `needs`. Sorted. */
  readonly dependsOn: readonly string[];
}

export interface Plan {
  readonly envVars: readonly EnvVarRequirement[];
  readonly docs: readonly DocRequirement[];
  readonly workstreams: readonly Workstream[];
  /** Vault-relative contract file paths, sorted. */
  readonly contracts: readonly string[];
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const DOC_FILE = /^[a-z0-9][a-z0-9._-]*\.md$/;
const TASK_ID = /^T\d+$/;
const TASK_LINE = /^(T\d+)\s*[:.]\s*(.+?)\s*(?:\(needs:\s*([^)]*)\))?\s*$/i;
const BULLET = /^[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/;
const LEADING_CODE = /^`([^`]+)`\s*(?:[:—–-]\s*)?(.*)$/;

// ---------------------------------------------------------------------------
// Markdown helpers

interface Bullet {
  readonly text: string;
  readonly checked: boolean | null;
}

/** `## Heading` sections (lowercased heading → lines). Ignores headings inside code fences. */
export function markdownSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const heading = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      current = [];
      sections.set(heading[1].toLowerCase(), current);
    } else if (!inFence && /^#\s/.test(line)) {
      current = null;
    } else {
      current?.push(line);
    }
  }
  return sections;
}

/** Top-level bullets only; indented lines (nested bullets, continuations) are ignored. */
function bullets(lines: readonly string[]): Bullet[] {
  const found: Bullet[] = [];
  for (const line of lines) {
    const match = BULLET.exec(line);
    const text = match?.[2]?.trim();
    if (match !== null && text !== undefined && text !== "") {
      found.push({ text, checked: match[1] === undefined ? null : match[1] !== " " });
    }
  }
  return found;
}

/** A lone "None" bullet means an intentionally empty list. */
function isNone(bullet: Bullet): boolean {
  return /^(none|n\/a)\b/i.test(bullet.text);
}

function section(
  sections: ReadonlyMap<string, string[]>,
  file: string,
  heading: string,
  issues: string[],
): string[] | null {
  const lines = sections.get(heading.toLowerCase());
  if (lines === undefined) {
    issues.push(`${file}: missing "## ${heading}" section`);
    return null;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// setup.md and docs-needed.md

export function parseSetup(text: string): ParseResult<readonly EnvVarRequirement[]> {
  const file = PLAN_FILES.setup;
  const issues: string[] = [];
  const lines = section(markdownSections(text), file, "Env vars", issues);
  const envVars: EnvVarRequirement[] = [];
  const seen = new Set<string>();
  for (const bullet of bullets(lines ?? []).filter((b) => !isNone(b))) {
    const match = LEADING_CODE.exec(bullet.text);
    const name = match?.[1];
    if (name === undefined || !ENV_NAME.test(name)) {
      issues.push(`${file}: env var bullet must start with \`NAME\`: "${bullet.text}"`);
      continue;
    }
    if (seen.has(name)) {
      issues.push(`${file}: env var ${name} is listed twice`);
      continue;
    }
    seen.add(name);
    const purpose = match?.[2] ?? "";
    envVars.push({
      name,
      purpose: purpose.replace(/\s*\(optional\)\s*/i, " ").trim(),
      optional: /\(optional\)/i.test(purpose),
    });
  }
  return issues.length === 0 ? { ok: true, value: envVars } : { ok: false, issues };
}

export function parseDocsNeeded(text: string): ParseResult<readonly DocRequirement[]> {
  const file = PLAN_FILES.docsNeeded;
  const issues: string[] = [];
  const lines = section(markdownSections(text), file, "Docs", issues);
  const docs: DocRequirement[] = [];
  const seen = new Set<string>();
  for (const bullet of bullets(lines ?? []).filter((b) => !isNone(b))) {
    const match = LEADING_CODE.exec(bullet.text);
    const name = match?.[1];
    if (name === undefined || !DOC_FILE.test(name) || name === "readme.md") {
      issues.push(
        `${file}: doc bullet must start with a lowercase file name like \`clerk.md\`: "${bullet.text}"`,
      );
      continue;
    }
    if (seen.has(name)) {
      issues.push(`${file}: doc ${name} is listed twice`);
      continue;
    }
    seen.add(name);
    docs.push({ file: name, description: (match?.[2] ?? "").trim() });
  }
  return issues.length === 0 ? { ok: true, value: docs } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Workstreams

/** Parses one workstream note. `needs` refs are normalized to "<ws>/<id>" but not resolved. */
export function parseWorkstream(name: string, text: string): ParseResult<Workstream> {
  const file = `${PLAN_FILES.workstreamsDir}/${name}.md`;
  const issues: string[] = [];
  if (!isValidSessionName(name)) {
    issues.push(`${file}: workstream names must be lowercase kebab-case (they become branches)`);
  }
  const sections = markdownSections(text);
  const goal = (section(sections, file, "Goal", issues) ?? []).join("\n").trim();
  const owns = bullets(section(sections, file, "Owns", issues) ?? []).map((b) =>
    b.text.replace(/^`([^`]+)`.*$/, "$1"),
  );
  const done = bullets(section(sections, file, "Definition of done", issues) ?? []).map(
    (b) => b.text,
  );
  const taskLines = section(sections, file, "Tasks", issues);

  if (sections.has("goal") && goal === "") {
    issues.push(`${file}: "## Goal" is empty`);
  }
  if (sections.has("owns") && owns.length === 0) {
    issues.push(`${file}: "## Owns" needs at least one path or glob`);
  }
  if (sections.has("definition of done") && done.length === 0) {
    issues.push(`${file}: "## Definition of done" needs at least one bullet`);
  }

  const tasks: PlanTask[] = [];
  for (const bullet of bullets(taskLines ?? [])) {
    const match = TASK_LINE.exec(bullet.text);
    const id = match?.[1]?.toUpperCase();
    const title = match?.[2];
    if (id === undefined || title === undefined) {
      issues.push(
        `${file}: task must look like "- [ ] T1: title (needs: ws/T2)": "${bullet.text}"`,
      );
      continue;
    }
    if (tasks.some((task) => task.id === id)) {
      issues.push(`${file}: task id ${id} is used twice`);
      continue;
    }
    const needs = (match?.[3] ?? "")
      .split(",")
      .map((need) => need.trim())
      .filter((need) => need !== "")
      .map((need) => (need.includes("/") ? need : `${name}/${need}`));
    tasks.push({ id, ref: `${name}/${id}`, title, needs, done: bullet.checked === true });
  }
  if (taskLines !== null && tasks.length === 0 && issues.length === 0) {
    issues.push(`${file}: "## Tasks" needs at least one task`);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const dependsOn = [
    ...new Set(tasks.flatMap((task) => task.needs.map((need) => need.split("/")[0] ?? need))),
  ]
    .filter((other) => other !== name)
    .sort();
  return { ok: true, value: { name, goal, owns, tasks, definitionOfDone: done, dependsOn } };
}

/** Cross-workstream checks: needs resolve, no cycles, no file owned by two workstreams. */
export function validateTaskGraph(workstreams: readonly Workstream[]): string[] {
  const issues: string[] = [];
  const tasks = new Map<string, PlanTask>();
  for (const workstream of workstreams) {
    for (const task of workstream.tasks) {
      tasks.set(task.ref, task);
    }
  }

  // Edges: each task depends on the previous task in its workstream, plus its `needs`.
  const edges = new Map<string, string[]>();
  for (const workstream of workstreams) {
    workstream.tasks.forEach((task, index) => {
      const previous = workstream.tasks[index - 1];
      const deps = previous === undefined ? [] : [previous.ref];
      for (const need of task.needs) {
        const [, id] = need.split("/");
        if (id === undefined || !TASK_ID.test(id) || !tasks.has(need)) {
          issues.push(`${task.ref} needs ${need}, which does not exist`);
        } else {
          deps.push(need);
        }
      }
      edges.set(task.ref, deps);
    });
  }

  const cycle = findCycle(edges);
  if (cycle !== null) {
    issues.push(`task dependencies form a cycle: ${cycle.join(" → ")}`);
  }

  const owners = new Map<string, string>();
  for (const workstream of workstreams) {
    for (const path of workstream.owns) {
      const owner = owners.get(path);
      if (owner !== undefined && owner !== workstream.name) {
        issues.push(`"${path}" is owned by both ${owner} and ${workstream.name}`);
      }
      owners.set(path, workstream.name);
    }
  }
  return issues;
}

function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const seen = state.get(node);
    if (seen === "done") {
      return null;
    }
    if (seen === "visiting") {
      return [...stack.slice(stack.indexOf(node)), node];
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const dep of edges.get(node) ?? []) {
      const cycle = visit(dep);
      if (cycle !== null) {
        return cycle;
      }
    }
    stack.pop();
    state.set(node, "done");
    return null;
  };
  for (const node of [...edges.keys()].sort()) {
    const cycle = visit(node);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Whole plan

/**
 * Validates a complete plan given as vault-relative path → content. Used on planner output
 * before anything is written, and on the vault by later milestones. Reports every issue.
 */
export function parsePlan(files: ReadonlyMap<string, string>): ParseResult<Plan> {
  const issues: string[] = [];
  for (const required of PLANNER_WRITTEN_FILES) {
    const content = files.get(required);
    if (content === undefined || content.trim() === "") {
      issues.push(`${required}: missing or empty`);
    }
  }

  const setup = files.get(PLAN_FILES.setup);
  const envVars = setup === undefined ? null : collect(parseSetup(setup), issues);
  const docsText = files.get(PLAN_FILES.docsNeeded);
  const docs = docsText === undefined ? null : collect(parseDocsNeeded(docsText), issues);

  const workstreams: Workstream[] = [];
  const prefix = `${PLAN_FILES.workstreamsDir}/`;
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const name = path.slice(prefix.length);
    if (name.includes("/") || !name.endsWith(".md")) {
      issues.push(`${path}: workstream notes must be ${prefix}<name>.md`);
      continue;
    }
    const workstream = collect(parseWorkstream(name.slice(0, -3), content), issues);
    if (workstream !== null) {
      workstreams.push(workstream);
    }
  }
  if (![...files.keys()].some((path) => path.startsWith(prefix))) {
    issues.push(`${prefix}: at least one workstream is required`);
  }
  if (workstreams.length > 0) {
    issues.push(...validateTaskGraph(workstreams));
  }

  const contracts = [...files.keys()]
    .filter((path) => path.startsWith(`${PLAN_FILES.contractsDir}/`))
    .sort();
  if (contracts.length === 0) {
    issues.push(`${PLAN_FILES.contractsDir}/: at least one contract file is required`);
  }

  if (issues.length > 0 || envVars === null || docs === null) {
    return { ok: false, issues };
  }
  return { ok: true, value: { envVars, docs, workstreams, contracts } };
}

function collect<T>(result: ParseResult<T>, issues: string[]): T | null {
  if (result.ok) {
    return result.value;
  }
  issues.push(...result.issues);
  return null;
}

/** Reads plan/ and contracts/ from the vault into a vault-relative path → content map. */
export async function readPlanFiles(paths: VaultPaths): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const dir of [paths.planDir, paths.contractsDir]) {
    for (const file of await listFiles(dir)) {
      const content = await readFileIfExists(file);
      if (content !== null) {
        files.set(relative(paths.root, file).split(sep).join("/"), content);
      }
    }
  }
  return files;
}

/** Files under `dir`, recursively, skipping dotfiles (e.g. .obsidian). [] if `dir` is missing. */
async function listFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// Generated task graph note

export function renderTaskGraph(plan: Plan): string {
  const rows = plan.workstreams.map((workstream) => {
    const done = workstream.tasks.filter((task) => task.done).length;
    const deps = workstream.dependsOn.length === 0 ? "-" : workstream.dependsOn.join(", ");
    return `| [[${PLAN_FILES.workstreamsDir}/${workstream.name}\\|${workstream.name}]] | ${done}/${workstream.tasks.length} | ${deps} |`;
  });

  const nodeId = (ref: string): string => ref.replaceAll("-", "_").replace("/", "__");
  const label = (text: string): string => text.replaceAll('"', "#quot;");
  const graph: string[] = ["flowchart TD"];
  for (const workstream of plan.workstreams) {
    graph.push(`  subgraph ${nodeId(workstream.name)}["${workstream.name}"]`);
    workstream.tasks.forEach((task, index) => {
      graph.push(`    ${nodeId(task.ref)}["${task.id}: ${label(task.title)}"]`);
      const previous = workstream.tasks[index - 1];
      if (previous !== undefined) {
        graph.push(`    ${nodeId(previous.ref)} --> ${nodeId(task.ref)}`);
      }
    });
    graph.push("  end");
  }
  for (const workstream of plan.workstreams) {
    for (const task of workstream.tasks) {
      for (const need of task.needs) {
        if (!need.startsWith(`${workstream.name}/`)) {
          graph.push(`  ${nodeId(need)} --> ${nodeId(task.ref)}`);
        }
      }
    }
  }

  return `---
tags: [plan, generated]
---
# Task graph

Generated by \`orc plan\` from \`${PLAN_FILES.workstreamsDir}/\`. Don't edit this note: edit the workstream notes.

| Workstream | Done | Waits on |
|---|---|---|
${rows.join("\n")}

\`\`\`mermaid
${graph.join("\n")}
\`\`\`
`;
}
