import { resolve } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { OrcError } from "../core/errors.js";
import type { AgentAdapter } from "./adapter.js";
import { FakeAgentAdapter } from "./fake.js";
import { loadFakeScript } from "./fake-script.js";

/** orc authenticates with an API key only (Decisions/0007). */
export const API_KEY_VAR = "ANTHROPIC_API_KEY";

/** Builds the adapter named by `config.adapter`. `env` is passed through to the agent process. */
export async function createAdapter(
  loaded: LoadedConfig,
  env: Readonly<Record<string, string | undefined>>,
): Promise<AgentAdapter> {
  switch (loaded.config.adapter) {
    case "fake":
      return new FakeAgentAdapter(
        await loadFakeScript(resolve(loaded.rootDir, loaded.config.fakeScript)),
      );
    case "claude-agent-sdk": {
      if ((env[API_KEY_VAR] ?? "").trim() === "") {
        throw new OrcError(
          "MISSING_API_KEY",
          `${API_KEY_VAR} is not set. Export it in your shell (orc doesn't read .env files), ` +
            'then run "orc check-setup".',
        );
      }
      // Loaded on demand so commands that never call an agent don't pay for importing the SDK.
      const { ClaudeSdkAdapter } = await import("./claude-sdk.js");
      return new ClaudeSdkAdapter({ env });
    }
  }
}
