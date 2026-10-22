---
tags: [context, config]
---
# `orc.config.json` reference

The config sits in the target app's root, or is passed with `--config <path>`. Every key is optional and unknown keys are errors. Code lives in `src/config/`. The rationale is in [[0003-config-shape-and-defaults]], [[0006-usd-run-cap-no-token-accounting]] and [[0008-plan-as-strict-markdown]].

| Key | Type | Default | Meaning |
|---|---|---|---|
| `vaultDir` | string | `"vault"` | Target vault, relative to the config file's directory |
| `adapter` | `"claude-agent-sdk"` \| `"fake"` | `"claude-agent-sdk"` | Which AgentAdapter drives sessions |
| `fakeScript` | string | `"orc.fake.json"` | Scripted replies for `adapter: "fake"`, relative to the config file. JSON `{ "turns": [{ "text" or "textFile", "costUsd"?, "outcome"?, "expect"?, … }] }`. See [[0008-plan-as-strict-markdown]] |
| `planner.model` | string | `"claude-opus-5-5"` | Model for `orc plan` |
| `coder.model` | string | `"claude-sonnet-5-5"` | Model for the coding sessions (one per workstream) |
| `driver.model` | string | `"claude-haiku-5-5"` | Model for driver decisions |
| `maxBudgetUsd` | number > 0 | `20` | Run-wide spend cap in USD, based on the Agent SDK's estimated `total_cost_usd` (not billing data). Each SDK call gets the remaining amount as its `maxBudgetUsd`. Hitting it escalates to `decisions.md` and pauses sessions |
| `retries.maxPerTask` | int ≥ 0 | `2` | Fix attempts after failed checks before escalating |
| `installCommand` | string | `""` | `orc integrate` runs this in the fresh integration worktree before the checks (e.g. `"npm ci"`), because a new worktree has no `node_modules`. Empty: the checks run on the bare checkout. A string; empty means none |
| `summaryBudgetUsd` | number > 0 | `0.25` | Fixed cap for one `orc summarize` narrative call, repair turns included. **Separate from `maxBudgetUsd`**: it is not drawn from the run budget and does not count toward it. Spend is kept in the `summarize` session note and shown by `orc status` |
| `checks[]` | `{name, command, timeoutMs?}` | typecheck, lint, test, build via npm scripts, 600000 ms each | Run in order after every session turn. Replaces the defaults if given |

**Removed:** the `budgets.perTaskTokens` and `budgets.perRunTokens` token caps. A `budgets` key is now rejected.

Environment: `ANTHROPIC_API_KEY` is required, and `orc check-setup` verifies it is set in the environment (see [[0007-shared-planner-prompt-and-api-key]]). The target app's own env vars may also live in `.env.local` or `.env` next to the config file.

The planner uses `maxBudgetUsd` as its own cap too, and passes the remaining amount to every turn.

`orc config` prints the resolved config together with `sourcePath`, `rootDir` and `vaultPath`. `orc.config.example.json` shows the defaults and is kept in sync by a test.
