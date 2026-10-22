import { describe, expect, it } from "vitest";
import { buildKit, mergeSection, SECTION_BEGIN, SECTION_END } from "./kit.js";

describe("buildKit", () => {
  it("builds the three skills and the driver subagent with the vault name filled in", async () => {
    const kit = await buildKit({ vaultDir: "notes" });

    expect(kit.files.map((file) => file.path)).toEqual([
      ".claude/skills/orc-plan/SKILL.md",
      ".claude/skills/orc-run/SKILL.md",
      ".claude/skills/orc-summarize/SKILL.md",
      ".claude/agents/orc-driver.md",
    ]);
    for (const file of kit.files) {
      expect(file.content).not.toContain("{{");
      expect(file.content.startsWith("---\n")).toBe(true);
    }
    expect(kit.section).toContain("`notes/`");
  });

  it("embeds the shared prompts, so there is one source for the CLI and the skills", async () => {
    const kit = await buildKit({ vaultDir: "vault" });
    const content = (path: string): string =>
      kit.files.find((file) => file.path === path)?.content ?? "";

    expect(content(".claude/skills/orc-plan/SKILL.md")).toContain(
      "### `plan/workstreams/<name>.md`",
    );
    expect(content(".claude/skills/orc-summarize/SKILL.md")).toContain("## Decisions for you");
    expect(content(".claude/agents/orc-driver.md")).toContain('{"action": "fix"');
    expect(content(".claude/agents/orc-driver.md")).toContain("model: haiku");
  });

  it("keeps every skill user-triggered and the driver read-only", async () => {
    const kit = await buildKit({ vaultDir: "vault" });
    for (const file of kit.files.filter((f) => f.path.includes("/skills/"))) {
      expect(file.content).toContain("disable-model-invocation: true");
    }
    expect(kit.files.at(-1)?.content).toContain("tools: Read, Grep, Glob");
  });

  it("tells coding sessions started by orc run to ignore the orchestrator block", async () => {
    const kit = await buildKit({ vaultDir: "vault" });
    expect(kit.section).toContain("Coding sessions started by `orc run` ignore this whole section");
  });

  it("tells automated paths to use --facts-only", async () => {
    const kit = await buildKit({ vaultDir: "vault" });
    const summarize = kit.files.find((file) => file.path.includes("orc-summarize"));
    expect(summarize?.content).toContain("orc summarize --facts-only");
  });
});

describe("mergeSection", () => {
  const section = `${SECTION_BEGIN}\nnew\n${SECTION_END}\n`;

  it("appends to existing text and creates a missing file", () => {
    expect(mergeSection("", section)).toBe(section);
    expect(mergeSection("# App\n", section)).toBe(`# App\n\n${section}`);
  });

  it("replaces only the orc block, keeping text before and after", () => {
    const old = `# App\n\n${SECTION_BEGIN}\nold\n${SECTION_END}\n\n## Mine\nkeep\n`;
    expect(mergeSection(old, section)).toBe(`# App\n\n${section}\n## Mine\nkeep\n`);
  });

  it("is idempotent", () => {
    const once = mergeSection("# App\n", section);
    expect(mergeSection(once, section)).toBe(once);
  });
});
