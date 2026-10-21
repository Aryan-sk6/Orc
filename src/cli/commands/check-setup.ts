import { relative } from "node:path";
import { loadConfig } from "../../config/load.js";
import { checkSetup, type SetupReport } from "../../planner/check-setup.js";
import { vaultPaths } from "../../vault/layout.js";
import { PLAN_FILES } from "../../vault/plan.js";
import { parseCommandArgs } from "../args.js";
import type { Command } from "../command.js";
import { renderTable } from "../table.js";

export const checkSetupCommand: Command = {
  name: "check-setup",
  summary: "Check that env vars and the docs the plan needs are in place",
  help: `Usage: orc check-setup [--json]

Checks, without any network calls:
  - ANTHROPIC_API_KEY is set in the environment (orc needs it)
  - every env var in plan/setup.md is set, in the environment or in
    .env.local / .env next to orc.config.json ("(optional)" ones are reported only)
  - every doc in plan/docs-needed.md exists and is not empty in <vault>/docs/

Values are never printed. Exits 1 if anything required is missing.

Options:
  --json    Print the report as JSON
`,
  run: async (argv, io) => {
    const { values } = parseCommandArgs(argv, { json: { type: "boolean" } });
    const loaded = await loadConfig({ cwd: io.cwd, path: values.config });
    const report = await checkSetup({
      rootDir: loaded.rootDir,
      vault: vaultPaths(loaded.vaultPath),
      env: io.env,
    });
    io.stdout(values.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderSetup(report));
    return report.ok ? 0 : 1;
  },
};

export function renderSetup(report: SetupReport): string {
  const sections: string[] = [`Setup check for ${report.rootDir}\n`];

  sections.push(
    `Env vars\n${indent(
      renderTable(
        [{ header: "STATUS" }, { header: "NAME" }, { header: "DETAIL", maxWidth: 80 }],
        report.envVars.map((v) => {
          if (v.foundIn !== null) {
            return ["ok", v.name, v.foundIn];
          }
          const detail = v.note !== "" ? v.note : v.purpose;
          return v.required
            ? ["MISSING", v.name, detail]
            : ["optional", v.name, `not set: ${detail}`];
        }),
      ),
    )}\n`,
  );

  if (report.docs.length > 0) {
    const docsDir = relative(report.rootDir, report.docsDir) || report.docsDir;
    sections.push(
      `Docs (${docsDir}/)\n${indent(
        renderTable(
          [{ header: "STATUS" }, { header: "FILE" }, { header: "WHAT TO PASTE", maxWidth: 80 }],
          report.docs.map((d) => [
            d.status === "ok" ? "ok" : d.status.toUpperCase(),
            d.file,
            d.status === "ok" ? "" : d.description,
          ]),
        ),
      )}\n`,
    );
  }

  if (report.planProblems.length > 0) {
    sections.push(`Plan problems\n${report.planProblems.map((p) => `  - ${p}\n`).join("")}`);
  }

  if (!report.planFound) {
    sections.push(
      `No plan yet (${PLAN_FILES.setup} not found), so only ${report.envVars[0]?.name ?? "the API key"} was checked.\n` +
        'Run "orc plan <idea.md>" first.\n',
    );
  } else if (report.ok) {
    sections.push("Setup complete.\n");
  } else {
    const count = report.missing;
    const what = count === 0 ? "The plan has problems" : `${count} missing`;
    sections.push(`${what}. Fix them, then run "orc check-setup" again.\n`);
  }
  return sections.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
