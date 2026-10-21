---
tags: [context, config]
---
# `orc.config.json` reference

The config sits in the target app's root, or is passed with `--config <path>`. Every key is optional and unknown keys are errors. Code lives in `src/config/`. The rationale is in [[0003-config-shape-and-defaults]] and [[0006-usd-run-cap-no-token-accounting]].

| Key | Type | Default | Meaning |
|---|---|---|---|
| `vaultDir` | string | `"vault"` | Target vault, relative to the config file's directory |
| `adapter` | `"claude-agent-sdk"` \| `"fake"` | `"claude-agent-sdk"` | Which AgentAdapter drives sessions |
| `planner.model` | string | `"claude-opus-5-5"` | Model for `orc plan` |
| `driver.model` | string | `"claude-haiku-5-5"` | Model for driver decisions |
| `maxBudgetUsd` | number > 0 | `20` | Run-wide spend cap in USD, based on the Agent SDK's estimated `total_cost_usd` (not billing data). Each SDK call gets the remaining amount as its `maxBudgetUsd`. Hitting it escalates to `decisions.md` and pauses sessions |
| `retries.maxPerTask` | int ≥ 0 | `2` | Fix attempts after failed checks before escalating |
| `checks[]` | `{name, command, timeoutMs?}` | typecheck, lint, test, build via npm scripts, 600000 ms each | Run in order after every session turn. Replaces the defaults if given |

**Removed:** the `budgets.perTaskTokens` and `budgets.perRunTokens` token caps. A `budgets` key is now rejected.

Environment: `ANTHROPIC_API_KEY` is required, and `orc check-setup` verifies it (see [[0007-shared-planner-prompt-and-api-key]]).

`orc config` prints the resolved config together with `sourcePath`, `rootDir` and `vaultPath`. `orc.config.example.json` shows the defaults and is kept in sync by a test.
