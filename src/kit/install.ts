import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { CONFIG_FILENAME } from "../config/load.js";
import { readFileIfExists, writeFileAtomic } from "../core/fs.js";
import { formatDecision } from "../vault/decisions.js";
import { ensureVault } from "../vault/init.js";
import { vaultPaths } from "../vault/layout.js";
import { renderSessionNote } from "../vault/session-note.js";
import { buildKit, type KitFile, mergeSection } from "./kit.js";

export type InstallAction = "created" | "updated" | "unchanged" | "kept";

export interface InstalledFile {
  /** Relative to the project root. */
  readonly path: string;
  readonly action: InstallAction;
}

export interface InstallOptions {
  readonly rootDir: string;
  readonly vaultDir: string;
  /** Overwrite kit files that differ from the shipped version. */
  readonly force: boolean;
  readonly kitDir?: string | undefined;
}

/** Names of the instruction files that get the orchestrator section. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * `orc init`: copies the kit into a project. Safe to run again. Files orc owns (skills, subagent)
 * are only replaced with `force`; AGENTS.md and CLAUDE.md only ever change inside the orc block;
 * the vault, its templates and the config are created when missing and never overwritten.
 */
export async function installKit(options: InstallOptions): Promise<InstalledFile[]> {
  const { rootDir } = options;
  const kit = await buildKit({ vaultDir: options.vaultDir, kitDir: options.kitDir });
  const report: InstalledFile[] = [];

  for (const file of kit.files) {
    report.push(await writeOwned(rootDir, file, options.force));
  }
  for (const name of INSTRUCTION_FILES) {
    report.push(await writeSection(rootDir, name, kit.section));
  }

  const paths = vaultPaths(join(rootDir, options.vaultDir));
  const vaultExisted = (await readFileIfExists(paths.log)) !== null;
  await ensureVault(paths);
  const templates: readonly KitFile[] = vaultTemplates(options.vaultDir);
  for (const template of templates) {
    report.push(await writeMissing(rootDir, template));
  }
  report.push({
    path: `${options.vaultDir}/`,
    action: vaultExisted ? "unchanged" : "created",
  });

  report.push(
    await writeMissing(rootDir, {
      path: CONFIG_FILENAME,
      content: `${JSON.stringify({ ...DEFAULT_CONFIG, vaultDir: options.vaultDir }, null, 2)}\n`,
    }),
  );
  report.push(await ensureIgnored(rootDir, `${options.vaultDir}/`));
  return report;
}

/**
 * Starter notes for people. Built from the same code that writes the real files, so a format
 * change in src/vault/ cannot leave them stale.
 */
export function vaultTemplates(vaultDir: string): KitFile[] {
  const templates = vaultPaths(join(".", vaultDir)).templatesDir;
  return [
    {
      path: join(templates, "session.md"),
      content: renderSessionNote({
        session: "<name>",
        workstream: "<workstream>",
        branch: "orc/<workstream>",
        status: "pending",
        currentTask: null,
        tasksDone: 0,
        tasksTotal: 0,
        checks: [],
        costUsd: 0,
        agentSession: null,
        costMayBeOvercounted: false,
        updated: "YYYY-MM-DD HH:mm",
      }),
    },
    {
      path: join(templates, "decision.md"),
      content: formatDecision({
        id: "D-000",
        status: "open",
        time: "YYYY-MM-DD HH:mm",
        session: "<session>",
        question: "<what the user must decide>",
        defaultTaken: null,
        reversible: false,
      }),
    },
  ];
}

async function writeOwned(rootDir: string, file: KitFile, force: boolean): Promise<InstalledFile> {
  const target = join(rootDir, file.path);
  const current = await readFileIfExists(target);
  if (current === file.content) {
    return { path: file.path, action: "unchanged" };
  }
  if (current !== null && !force) {
    return { path: file.path, action: "kept" };
  }
  await write(target, file.content);
  return { path: file.path, action: current === null ? "created" : "updated" };
}

async function writeMissing(rootDir: string, file: KitFile): Promise<InstalledFile> {
  const target = join(rootDir, file.path);
  if ((await readFileIfExists(target)) !== null) {
    return { path: file.path, action: "unchanged" };
  }
  await write(target, file.content);
  return { path: file.path, action: "created" };
}

async function writeSection(
  rootDir: string,
  name: string,
  section: string,
): Promise<InstalledFile> {
  const target = join(rootDir, name);
  const current = await readFileIfExists(target);
  const next = mergeSection(current ?? "", section);
  if (current === next) {
    return { path: name, action: "unchanged" };
  }
  await write(target, next);
  return { path: name, action: current === null ? "created" : "updated" };
}

/** Adds `entry` to .gitignore: orc refuses to run when the vault is tracked. */
async function ensureIgnored(rootDir: string, entry: string): Promise<InstalledFile> {
  const target = join(rootDir, ".gitignore");
  const current = await readFileIfExists(target);
  const lines = (current ?? "").split(/\r?\n/).map((line) => line.trim());
  const bare = entry.replace(/\/$/, "");
  if (
    lines.includes(entry) ||
    lines.includes(bare) ||
    lines.includes(`/${entry}`) ||
    lines.includes(`/${bare}`)
  ) {
    return { path: ".gitignore", action: "unchanged" };
  }
  const prefix = current === null || current === "" || current.endsWith("\n") ? "" : "\n";
  await write(target, `${current ?? ""}${prefix}${entry}\n`);
  return { path: ".gitignore", action: current === null ? "created" : "updated" };
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content);
}
