import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorMessage, OrcError } from "../core/errors.js";

/** The kit directory. Same relative path from src/kit/ (tests) and dist/kit/. */
export const KIT_DIR = fileURLToPath(new URL("../../kit/", import.meta.url));

/** One file `orc init` writes, with its path relative to the project root. */
export interface KitFile {
  readonly path: string;
  readonly content: string;
}

export interface KitOptions {
  /** Vault folder name inside the project, as in `vaultDir` of orc.config.json. */
  readonly vaultDir: string;
  /** Kit directory to read; defaults to the one shipped with orc. */
  readonly kitDir?: string | undefined;
}

/** Skill name → files. The prompt files are embedded from kit/prompts/, so there is one source. */
const SKILLS = [
  { name: "orc-plan", prompts: ["planner"] },
  { name: "orc-run", prompts: [] },
  { name: "orc-summarize", prompts: ["summary"] },
] as const;

const PROMPTS = ["planner", "driver", "summary"] as const;
type PromptName = (typeof PROMPTS)[number];

/** Start and end of the orchestrator section inside AGENTS.md / CLAUDE.md. */
export const SECTION_BEGIN = "<!-- orc:begin (managed by `orc init`; edit outside this block) -->";
export const SECTION_END = "<!-- orc:end -->";

/** Markers of the target app's own guide (plan/agents.md) inside AGENTS.md. */
export const GUIDE_BEGIN =
  "<!-- orc:app-guide:begin (copied from the vault plan by `orc plan`) -->";
export const GUIDE_END = "<!-- orc:app-guide:end -->";

export interface Markers {
  readonly begin: string;
  readonly end: string;
}
const ORCHESTRATOR_MARKERS: Markers = { begin: SECTION_BEGIN, end: SECTION_END };

/**
 * Everything the kit puts in `.claude/` plus the orchestrator section text. `{{vault}}` becomes the
 * vault folder and `{{prompt:x}}` the contents of kit/prompts/x.md, so a prompt change in
 * kit/prompts/ reaches `orc plan`, `orc summarize` and the installed skills together.
 */
export async function buildKit(options: KitOptions): Promise<{
  readonly files: readonly KitFile[];
  readonly section: string;
}> {
  const dir = options.kitDir ?? KIT_DIR;
  const prompts = new Map<PromptName, string>();
  for (const name of PROMPTS) {
    prompts.set(name, stripTitle(await readKitFile(dir, `prompts/${name}.md`)));
  }
  const render = (template: string): string => fill(template, options.vaultDir, prompts);

  const files: KitFile[] = [];
  for (const skill of SKILLS) {
    const template = await readKitFile(dir, `skills/${skill.name}/SKILL.md`);
    files.push({
      path: `.claude/skills/${skill.name}/SKILL.md`,
      content: render(template),
    });
  }
  files.push({
    path: ".claude/agents/orc-driver.md",
    content: render(await readKitFile(dir, "agents/orc-driver.md")),
  });

  const section = render(await readKitFile(dir, "orchestrator.md")).trim();
  return { files, section: `${SECTION_BEGIN}\n${section}\n${SECTION_END}\n` };
}

/**
 * Puts `section` into `text`: replaces an existing orc block in place, otherwise appends it.
 * Everything outside the markers is kept byte for byte.
 */
export function mergeSection(
  text: string,
  section: string,
  markers: Markers = ORCHESTRATOR_MARKERS,
): string {
  const begin = text.indexOf(markers.begin);
  const end = text.indexOf(markers.end);
  if (begin !== -1 && end > begin) {
    const after = end + markers.end.length;
    return `${text.slice(0, begin)}${section.trimEnd()}${text.slice(after).replace(/^\r?\n/, "\n")}`;
  }
  if (text.trim() === "") {
    return section;
  }
  return `${text.trimEnd()}\n\n${section}`;
}

function fill(
  template: string,
  vaultDir: string,
  prompts: ReadonlyMap<PromptName, string>,
): string {
  return template
    .replaceAll("{{vault}}", vaultDir)
    .replace(/\{\{prompt:([a-z]+)\}\}/g, (_match, name: string) => {
      const prompt = PROMPTS.find((candidate) => candidate === name);
      const text = prompt === undefined ? undefined : prompts.get(prompt);
      if (text === undefined) {
        throw new OrcError("PROMPT_NOT_FOUND", `kit template names an unknown prompt "${name}"`);
      }
      return text;
    });
}

/** The prompt files start with a `# title`; inside a skill that heading would be noise. */
function stripTitle(prompt: string): string {
  return prompt.replace(/^# [^\n]*\n+/, "").trim();
}

async function readKitFile(dir: string, relative: string): Promise<string> {
  try {
    return await readFile(`${dir}${relative}`, "utf8");
  } catch (error) {
    throw new OrcError(
      "PROMPT_NOT_FOUND",
      `cannot read the kit file ${dir}${relative}: ${errorMessage(error)}`,
    );
  }
}
