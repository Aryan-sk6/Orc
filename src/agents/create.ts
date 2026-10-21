import { resolve } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { OrcError } from "../core/errors.js";
import type { AgentAdapter } from "./adapter.js";
import { FakeAgentAdapter } from "./fake.js";
import { loadFakeScript } from "./fake-script.js";

/** Builds the adapter named by `config.adapter`. */
export async function createAdapter(loaded: LoadedConfig): Promise<AgentAdapter> {
  switch (loaded.config.adapter) {
    case "fake":
      return new FakeAgentAdapter(
        await loadFakeScript(resolve(loaded.rootDir, loaded.config.fakeScript)),
      );
    case "claude-agent-sdk":
      throw new OrcError(
        "ADAPTER_UNAVAILABLE",
        'the Claude Agent SDK adapter arrives in M3. For now set "adapter": "fake" in orc.config.json ' +
          'and point "fakeScript" at a scripted-output file.',
      );
  }
}
