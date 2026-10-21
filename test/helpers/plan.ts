import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "../../src/core/fs.js";
import { parseFileBlocks } from "../../src/planner/protocol.js";

const REPLY = fileURLToPath(new URL("../fixtures/planner/plan-reply.md", import.meta.url));

/** Writes the todo-app fixture plan (plan/ and contracts/) into `vaultRoot`. */
export async function writeFixturePlan(vaultRoot: string): Promise<void> {
  const parsed = parseFileBlocks(await readFile(REPLY, "utf8"));
  if (!parsed.ok) {
    throw new Error(parsed.issues.join("\n"));
  }
  for (const [path, content] of parsed.value) {
    await writeFileAtomic(join(vaultRoot, ...path.split("/")), content);
  }
}
