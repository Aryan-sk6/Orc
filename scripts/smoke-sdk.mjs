// Live smoke test of the Claude Agent SDK adapter. SPENDS REAL MONEY (a few cents, capped).
// Not part of `npm test`. Run it yourself: ANTHROPIC_API_KEY=... npm run smoke:sdk
// It runs three turns on a cheap model in a temp folder:
//   1. read-only: read a file and answer   2. resume: per-turn cost delta   3. edit: write a file + allowed command
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeSdkAdapter } from "../dist/agents/claude-sdk.js";

const MODEL = process.env.ORC_SMOKE_MODEL ?? "claude-haiku-5-5";
const BUDGET_PER_TURN = 0.25;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first. This script spends real money (a few cents).");
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), "orc-smoke-"));
const adapter = new ClaudeSdkAdapter({ env: process.env });
let failed = false;

function report(label, result) {
  console.log(`\n== ${label}`);
  console.log(`   outcome: ${result.outcome}  cost: $${result.costUsd}  ${result.durationMs} ms`);
  console.log(`   session: ${result.sessionId}`);
  console.log(`   text:    ${JSON.stringify(result.text.slice(0, 200))}`);
  if (result.errors.length > 0) console.log(`   errors:  ${result.errors.join(" | ")}`);
  if (result.deniedActions.length > 0)
    console.log(`   denied:  ${result.deniedActions.join(" | ")}`);
}

function check(condition, message) {
  console.log(`   ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failed = true;
}

try {
  await writeFile(join(dir, "hello.txt"), "orc smoke test line one\nline two\n");
  const base = { cwd: dir, model: MODEL, maxBudgetUsd: BUDGET_PER_TURN };

  const read = await adapter.runTurn({
    ...base,
    access: "read-only",
    prompt: "Read hello.txt and reply with its first line only, nothing else.",
    onEvent: (event) => event.type === "tool" && console.log(`   tool: ${event.name}`),
  });
  report("1. read-only turn", read);
  check(read.outcome === "success", "outcome is success");
  check(read.text.includes("orc smoke test line one"), "reply contains the file's first line");
  check(read.costUsd > 0, "cost is reported");

  const resumed = await adapter.runTurn({
    ...base,
    access: "read-only",
    resumeSessionId: read.sessionId,
    prompt: "Which file did you just read? Reply with the file name only.",
  });
  report("2. resumed turn", resumed);
  check(resumed.sessionId === read.sessionId, "same session id");
  check(resumed.text.includes("hello.txt"), "remembers the earlier turn");
  check(resumed.costUsd > 0 && resumed.costUsd < read.costUsd * 5, "cost is a per-turn delta");

  const edit = await adapter.runTurn({
    ...base,
    access: "edit",
    allowedCommands: ["node --version"],
    prompt:
      "Create a file out.txt containing exactly the word ok. Then run `node --version` and reply with its output only.",
  });
  report("3. edit turn", edit);
  const out = await readFile(join(dir, "out.txt"), "utf8").catch(() => "(missing)");
  check(out.trim() === "ok", `out.txt was written (${JSON.stringify(out.trim())})`);
  check(/v\d+\./.test(edit.text), "allowed command ran");

  const total = read.costUsd + resumed.costUsd + edit.costUsd;
  console.log(
    `\nTotal estimated cost: $${total.toFixed(4)} (Agent SDK estimate, not billing data)`,
  );
} finally {
  await adapter.close();
  await rm(dir, { recursive: true, force: true });
}
console.log(failed ? "\nSMOKE TEST FAILED" : "\nSmoke test passed");
process.exit(failed ? 1 : 0);
