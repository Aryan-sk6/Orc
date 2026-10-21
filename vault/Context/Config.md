---
tags: [context, config]
---
# `orc.config.json` reference

The config sits in the target app's root, or is passed with `--config <path>`. Every key is optional and unknown keys are errors. Code lives in `src/config/` and the rationale is in [[0003-config-shape-and-defaults]].

| Key | Type | Default | Meaning |
|---|---|---|---|
| `vaultDir` | string | `"vault"` | Target vault, relative to the config file's directory |
| `adapter` | `"claude-agent-sdk"` \| `"fake"` | `"claude-agent-sdk"` | Which AgentAdapter drives sessions |
| `planner.model` | string | `"claude-opus-5-5"` | Model for `orc plan` |
| `driver.model` | string | `"claude-haiku-5-5"` | Model for driver decisions |
| `budgets.perTaskTokens` | int ≥ 1 | `500000` | Per-task cap. Hitting it escalates to `decisions.md` and pauses the session |
| `budgets.perRunTokens` | int ≥ 1 | `10000000` | Whole-run cap. Must be ≥ `perTaskTokens` |
| `retries.maxPerTask` | int ≥ 0 | `2` | Fix attempts after failed checks before escalating |
| `checks[]` | `{name, command, timeoutMs?}` | typecheck, lint, test, build via npm scripts, 600000 ms each | Run in order after every session turn. Replaces the defaults if given |

`orc config` prints the resolved config together with `sourcePath`, `rootDir` and `vaultPath`. `orc.config.example.json` shows the defaults and is kept in sync by a test.
