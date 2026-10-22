# orc

A TypeScript CLI that orchestrates AI coding sessions to build an app from one plan.

You give it an idea. It asks clarifying questions and writes a plan (architecture, contracts, workstreams with tasks). Then it runs one coding session per workstream in parallel git worktrees, gates every turn on your own check commands, and merges the finished work. Everything it knows lives in a plain-markdown vault you can open in Obsidian.

> **Status:** M0–M5 are built and tested against a scripted fake agent. The real Claude Agent SDK path has not been dogfooded yet, so the [numbers](#numbers) below are empty on purpose. Nothing here is a measured result until that table is filled.

## How it works

1. `orc plan idea.md` asks 10–15 questions, then writes the plan into the app's vault.
2. `orc check-setup` reports missing env vars and docs the plan needs.
3. `orc run` creates a worktree and branch (`orc/<workstream>`) per workstream and starts a coding session in each, in parallel. Before each task it tags a checkpoint. After each turn it runs your checks. If they pass, the next task is sent **with no model call**. If they fail, a small driver model writes a short fix prompt or escalates. A session pauses at the retry cap or the budget cap, with the reason written to `decisions.md`; the others keep going.
4. `orc integrate` merges finished workstreams into `orc-integration/<milestone>` and runs the full checks there. No model call. Conflicts and failures escalate; orc never resolves them itself.
5. `orc summarize` writes `report.md`: a short narrative plus tables of sessions, decisions and spend.
6. `orc rewind <checkpoint>` puts a workstream back to the state before a task. The discarded work is kept under a backup tag.

LLM calls happen in three places only: the planner, the driver (fix or escalate), and the optional summary narrative. Everything else is deterministic.

## Install

Requires Node ≥ 20 and `ANTHROPIC_API_KEY` in the environment.

```
npm install
npm run build
node dist/cli/index.js --help
```

## Commands

| Command | What it does |
|---|---|
| `orc plan <idea.md> [--force] [--defaults]` | Questions, then the plan. `--defaults` accepts every suggested answer |
| `orc check-setup` | Env vars (including the API key) and required docs |
| `orc run [--workstream <name>]...` | Run sessions until done or paused. Re-run to resume; finished tasks are skipped |
| `orc integrate [--milestone <name>]` | Merge finished workstreams, run install and checks |
| `orc rewind <checkpoint> [--force]` / `--list` | Undo to a checkpoint such as `api/T3` |
| `orc summarize [--facts-only]` | Write `report.md`. `--facts-only` makes no model call |
| `orc status [--json]` | Sessions, current task, checks, estimated spend |
| `orc log <text> -s <session>` / `--tail <n>` | Append to or read the vault LOG |
| `orc config` | Print the resolved config |

Global options go anywhere: `-c, --config <path>`, `-h`, `-v`. Command options come after the command name.

## Config

`orc.config.json` sits in the app's root. Every key is optional; unknown keys are errors. Full defaults are in [`orc.config.example.json`](orc.config.example.json).

| Key | Default | Meaning |
|---|---|---|
| `vaultDir` | `"vault"` | The app's vault, relative to the config file |
| `adapter` | `"claude-agent-sdk"` | Or `"fake"` to replay `fakeScript` and spend nothing |
| `planner.model` / `coder.model` / `driver.model` | Opus / Sonnet / Haiku | One model per role |
| `maxBudgetUsd` | `20` | Run-wide cap, from the SDK's estimated cost (not billing data) |
| `retries.maxPerTask` | `2` | Fix prompts after failed checks before escalating |
| `installCommand` | `""` | Run in the integration worktree before the checks, e.g. `"npm ci"` |
| `summaryBudgetUsd` | `0.25` | Separate cap for one `orc summarize` narrative |
| `checks[]` | typecheck, lint, test, build | Commands run after every turn |

## The two vaults

- **orc's own `vault/`** (in this repo) is the project memory for developing orc: sessions, decisions, context.
- **The target app's vault** is what orc reads and writes at runtime inside the app it builds: `LOG.md`, `sessions/`, `decisions.md`, `rules.md`, `plan/`, `contracts/`, `docs/`, `report.md`.

The app's vault must **not** be tracked by git (`orc run` and `orc integrate` refuse otherwise). Add `vault/` to the app's `.gitignore`.

## Try it without spending anything

```
npm run demo:status      # orc status on a fake vault
npm run demo:plan        # orc plan on a todo idea with the fake adapter
```

## Dogfooding on a real todo app (costs money)

```
export ANTHROPIC_API_KEY=...
npm run smoke:sdk                    # 3 cheap turns through the real adapter, a few cents
npm run dogfood:setup                # creates .dogfood/todo-app (git repo, config with maxBudgetUsd 3)
node scripts/dogfood.mjs time plan idea.md
node scripts/dogfood.mjs time check-setup
node scripts/dogfood.mjs time run
node scripts/dogfood.mjs time integrate
node scripts/dogfood.mjs time summarize
node scripts/dogfood.mjs time status
```

`time` runs the command inside the app and appends wall-clock seconds and the exit code to `.dogfood/numbers.tsv`. Cost comes from `orc status` and the `orc plan` output; planner spend is not in a session note, so copy it from that output. Fill in the table below from those two sources, and from `report.md`.

## Numbers

Not measured yet. To be filled from a real run of the steps above.

| Step | Wall time | Cost (USD) | Notes |
|---|---|---|---|
| `orc plan` | | | |
| `orc run` (workstream `api`) | | | |
| `orc run` (workstream `web`) | | | |
| `orc integrate` | | no model call | |
| `orc summarize` | | | capped by `summaryBudgetUsd` |
| **Total** | | | |

Costs are the Agent SDK's client-side estimate. Check the Claude Console for billing.

## Development

```
npm run check    # typecheck + lint + test; run before every commit
```

Contributor and agent conventions are in [`agents.md`](agents.md). Project memory is in [`vault/`](vault/Home.md).

## License

MIT
