import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../test/helpers/tmp-dir.js";
import { loadConfig } from "../config/load.js";
import { parseDecisions } from "../vault/decisions.js";
import { installKit } from "./install.js";

const tmp = useTmpDir("orc-kit-");

const options = (force = false): { rootDir: string; vaultDir: string; force: boolean } => ({
  rootDir: tmp(),
  vaultDir: "vault",
  force,
});

const read = (path: string): Promise<string> => readFile(join(tmp(), path), "utf8");

describe("installKit in an empty project", () => {
  it("creates skills, subagent, instruction files, vault, config and .gitignore", async () => {
    const report = await installKit(options());

    expect(report.every((file) => file.action === "created")).toBe(true);
    for (const path of [
      ".claude/skills/orc-plan/SKILL.md",
      ".claude/skills/orc-run/SKILL.md",
      ".claude/skills/orc-summarize/SKILL.md",
      ".claude/agents/orc-driver.md",
      "vault/LOG.md",
      "vault/decisions.md",
      "vault/rules.md",
      "vault/docs/README.md",
      "vault/templates/session.md",
      "vault/templates/decision.md",
    ]) {
      expect(await read(path)).not.toBe("");
    }
    expect(await read("AGENTS.md")).toContain("orc orchestrator");
    expect(await read("CLAUDE.md")).toContain("never write app code");
    expect((await read(".gitignore")).split("\n")).toContain("vault/");
  });

  it("writes a config that orc itself accepts", async () => {
    await installKit(options());
    const loaded = await loadConfig({ cwd: tmp() });
    expect(loaded.sourcePath).toBe(join(tmp(), "orc.config.json"));
    expect(loaded.config.adapter).toBe("claude-agent-sdk");
  });

  it("writes templates that show the real formats but can never be read as real entries", async () => {
    await installKit(options());
    const decision = await read("vault/templates/decision.md");
    expect(decision).toContain("- Question: <what the user must decide>");
    expect(parseDecisions(decision)).toEqual([]);
    expect(await read("vault/templates/session.md")).toContain("## Progress");
  });
});

describe("installKit in an existing project", () => {
  it("keeps existing AGENTS.md text and .gitignore lines, and is idempotent", async () => {
    await writeFile(join(tmp(), "AGENTS.md"), "# My app\n\nUse pnpm.\n");
    await writeFile(join(tmp(), ".gitignore"), "node_modules/\n");

    await installKit(options());
    const first = await read("AGENTS.md");
    expect(first.startsWith("# My app\n\nUse pnpm.\n")).toBe(true);
    expect(await read(".gitignore")).toBe("node_modules/\nvault/\n");

    const again = await installKit(options());
    expect(again.every((file) => file.action === "unchanged")).toBe(true);
    expect(await read("AGENTS.md")).toBe(first);
  });

  it("does not add a second vault/ line when one is already ignored", async () => {
    await writeFile(join(tmp(), ".gitignore"), "/vault\n");
    await installKit(options());
    expect(await read(".gitignore")).toBe("/vault\n");
  });

  it("keeps a customised skill unless forced", async () => {
    await installKit(options());
    const skill = join(tmp(), ".claude/skills/orc-run/SKILL.md");
    await writeFile(skill, "mine\n");

    const kept = await installKit(options());
    expect(kept.find((file) => file.path.endsWith("orc-run/SKILL.md"))?.action).toBe("kept");
    expect(await readFile(skill, "utf8")).toBe("mine\n");

    const forced = await installKit(options(true));
    expect(forced.find((file) => file.path.endsWith("orc-run/SKILL.md"))?.action).toBe("updated");
    expect(await readFile(skill, "utf8")).toContain("name: orc-run");
  });

  it("never overwrites an existing vault file or config", async () => {
    await mkdir(join(tmp(), "vault"), { recursive: true });
    await writeFile(join(tmp(), "vault", "rules.md"), "- no semicolons\n");
    await writeFile(join(tmp(), "orc.config.json"), '{"maxBudgetUsd": 3}');

    await installKit(options(true));

    expect(await read("vault/rules.md")).toBe("- no semicolons\n");
    expect(await read("orc.config.json")).toBe('{"maxBudgetUsd": 3}');
  });

  it("uses the configured vault folder name", async () => {
    await installKit({ rootDir: tmp(), vaultDir: "notes", force: false });
    expect(await read("notes/LOG.md")).not.toBe("");
    expect(await read("AGENTS.md")).toContain("`notes/`");
    expect((await read(".gitignore")).split("\n")).toContain("notes/");
  });
});
