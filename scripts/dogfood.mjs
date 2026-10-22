// Dogfood helper for M6. Prepares a throwaway todo app repo and times each orc command.
//   node scripts/dogfood.mjs setup            create .dogfood/todo-app (git repo, config, idea.md)
//   node scripts/dogfood.mjs time <orc args>  run `orc <args>` in the app, append wall time to numbers.tsv
// `setup` spends nothing. The timed commands (plan, run, integrate, summarize) spend real money,
// capped by maxBudgetUsd in the generated config. Needs `npm run build` first and ANTHROPIC_API_KEY.
import { execFileSync, spawn } from "node:child_process";
import { appendFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, ".dogfood", "todo-app");
const orcBin = join(root, "dist", "cli", "index.js");
const numbersFile = join(root, ".dogfood", "numbers.tsv");

const IDEA = `# Todo app

A small web app to keep a personal todo list. Sign in, add todos, tick them off, delete them.
Filter by all / open / done. Should feel fast. Single user per account, no sharing.

Keep it small: Node + TypeScript, an HTTP API with file-based storage, and a plain web front end.
Plan exactly two workstreams: \`api\` (accounts, todos, storage) and \`web\` (the front end that uses
the API's contract). The first task of each workstream must install its dependencies in its own
worktree. Every task must leave typecheck, lint, test and build passing.
`;

const CONFIG = {
  vaultDir: "vault",
  maxBudgetUsd: 3,
  installCommand: "npm install",
};

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: appDir, encoding: "utf8" });
}

async function setup() {
  if (await exists(appDir)) {
    console.error(`${appDir} already exists. Delete it to start over: rm -rf .dogfood`);
    process.exit(1);
  }
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, "idea.md"), IDEA);
  await writeFile(join(appDir, "orc.config.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  // orc refuses a git-tracked vault, and the app repo needs at least one commit.
  await writeFile(join(appDir, ".gitignore"), "vault/\nnode_modules/\ndist/\n");
  git("init", "-b", "main");
  git("add", ".gitignore", "idea.md", "orc.config.json");
  git("commit", "--no-verify", "-m", "chore: dogfood start");
  await writeFile(numbersFile, "when\tcommand\tseconds\texit\n");
  console.log(`Ready: ${appDir}`);
  console.log("Next (from the orc repo, with ANTHROPIC_API_KEY exported, after npm run build):");
  for (const step of ["plan idea.md", "check-setup", "run", "integrate", "summarize", "status"]) {
    console.log(`  node scripts/dogfood.mjs time ${step}`);
  }
  console.log("Cost: `orc status` and the report. Times: .dogfood/numbers.tsv");
}

async function timed(orcArgs) {
  if (!(await exists(appDir))) {
    console.error("Run `node scripts/dogfood.mjs setup` first.");
    process.exit(1);
  }
  if (!(await exists(orcBin))) {
    console.error("Run `npm run build` first.");
    process.exit(1);
  }
  const started = Date.now();
  const code = await new Promise((done) => {
    const child = spawn("node", [orcBin, ...orcArgs], { cwd: appDir, stdio: "inherit" });
    child.on("exit", (exit) => done(exit ?? 1));
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const when = new Date().toISOString();
  await appendFile(numbersFile, `${when}\t${orcArgs.join(" ")}\t${seconds}\t${code}\n`);
  console.log(`\n[dogfood] orc ${orcArgs.join(" ")}: ${seconds}s, exit ${code}`);
  process.exit(code);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "setup") await setup();
else if (command === "time" && rest.length > 0) await timed(rest);
else if (command === "clean") await rm(join(root, ".dogfood"), { recursive: true, force: true });
else {
  console.error("Usage: node scripts/dogfood.mjs setup | time <orc args> | clean");
  process.exit(2);
}
