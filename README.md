<div align="center">

# orc

**Turn one app idea into a plan, then let parallel AI coding sessions build it, with your own checks as the gate and a hard spending cap.**

[![npm](https://img.shields.io/npm/v/orc-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/orc-cli)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

</div>

> **Status: beta.** orc is fully built and covered by 360+ tests that run against a scripted fake agent. It has **not yet been run end to end against the live Claude API**, so prompts may need tuning and I have no measured time or cost numbers to show you. See [Honest status](#honest-status). If you try it, please [open an issue](https://github.com/Aryan-sk6/Orc/issues) with what happened. That is the most useful thing anyone can do for this project.

---

## The problem

One AI coding session building a whole app drifts. It forgets the plan, edits files it should not, declares victory with a red build, and you only find out at the end. Running several sessions yourself means juggling branches, prompts and merge conflicts by hand.

## What orc does

You write a paragraph about the app you want. orc then:

1. **Plans it.** Asks you 10 to 15 sharp questions, then writes the architecture, **frozen shared contracts** (DB schema, API types), an `agents.md` for the app, a setup checklist and a task graph split into workstreams that own separate files.
2. **Builds it in parallel.** One coding session per workstream, each in its own git worktree and branch.
3. **Gates every turn on your checks.** After each turn orc runs your typecheck, lint, tests and build. If they pass, the next task goes out **with no model call at all**. If they fail, a small, cheap model writes a short, specific fix prompt, or escalates to you.
4. **Stays inside a budget.** A hard USD cap for the whole run, plus a retry cap per task. When a cap is hit, that session pauses and the reason is written down while the others keep going.
5. **Merges and reports.** Finished workstreams are merged into an integration branch and the full checks run there. A report tells you what was built, what went wrong and what needs your decision.

```
 idea.md
    │  orc plan  ── 10-15 questions ──▶  plan · contracts · agents.md · task graph
    ▼
 ┌──────────────── orc run (parallel) ────────────────┐
 │  worktree orc/api      worktree orc/web     ...    │
 │  ┌────────────┐        ┌────────────┐              │
 │  │ checkpoint │        │ checkpoint │   tag before │
 │  │ coding turn│        │ coding turn│   every task │
 │  │ your checks│        │ your checks│              │
 │  └─pass─▶ next task (no model call)                │
 │  └─fail─▶ small model: fix prompt, or escalate     │
 └──────────────────────────┬─────────────────────────┘
                            ▼
              orc integrate ── merge + full checks (no model call)
                            ▼
                      orc summarize ── report.md
```

## Why you might like it

- **Your checks are the judge, not the model.** "Done" means your own `npm test` and `npm run build` pass, not that the agent says so.
- **Cheap by design.** Most turns need no steering model. The steering model is a small one, and it is called only after a failure.
- **You cannot be surprised by the bill.** One run-wide `maxBudgetUsd`, one retry cap, and a separate tiny cap for the report. No run is unbounded.
- **Everything is undoable.** A git tag is created before every task. `orc rewind api/T3` puts a workstream back, and the discarded work is kept under a backup tag. orc never deletes a branch.
- **Plain files you can read.** All state is markdown in a vault you can open in Obsidian: the plan, one note per session, a one-line-per-step log, and a `decisions.md` of everything that needed a human.
- **Pauses instead of guessing.** Contradicting contracts, missing secrets, repeated failures and merge conflicts become numbered decisions for you. orc never resolves a conflict on its own.
- **Resumable.** Stop with Ctrl-C or `orc stop`, fix whatever you like, run `orc run` again. Finished tasks are skipped and the agent conversation continues.
- **Provider-agnostic core.** Coding sessions go through an `AgentAdapter` interface. The Claude Agent SDK is the first implementation, and the whole test suite runs on a fake adapter that spends nothing.

## Quick start

Requires **Node 20+**, **git**, and an **`ANTHROPIC_API_KEY`**. Run it from the root of the git repo that will hold your app (at least one commit).

```bash
npm install -g orc-cli          # installs the `orc` command

cd my-new-app && git init && git commit --allow-empty -m "init"
orc init                        # kit, vault and config (see below)
echo "A todo app with accounts, due dates and sharing." > idea.md

export ANTHROPIC_API_KEY=sk-ant-...
orc plan idea.md                # answer the questions (Enter takes the default)
orc check-setup                 # lists the env vars and docs you still owe the plan
orc run                         # builds it; re-run to resume after a pause
orc integrate                   # merge workstreams, run the full checks
orc summarize                   # report.md
orc status                      # sessions, tasks, checks, estimated spend
```

Set `maxBudgetUsd` in `orc.config.json` **before** your first `orc run`. The default is 20.

## Use it from inside Claude Code

`orc init` also installs a small kit so you can drive everything from a Claude Code session (including Orca and the VS Code extension):

| Installed | What it gives you |
|---|---|
| `/orc-plan <idea.md>` | The planner prompt as a slash command: asks the questions in chat, writes the plan, validates it with `orc plan --check` |
| `/orc-run` | Pre-checks, shows the budget, asks before spending, runs `orc run`, reports paused decisions |
| `/orc-summarize` | Writes the final report (`--facts-only` tables plus a narrative, from the same prompt `orc summarize` uses) |
| `orc-driver` subagent | A read-only agent on a small model that decides "fix prompt or escalate" |
| `AGENTS.md` / `CLAUDE.md` block | Tells the main agent to be the orchestrator: ask, plan, launch, report, **never write app code** |
| `<vault>/templates/` | Session and decision note templates |

Run `orc init` **before** opening Claude Code in the folder (a new `.claude/agents/` directory is only picked up at session start). It is safe to run again; `orc init --check` tells you if the installed kit is out of date.

## Commands

| Command | What it does |
|---|---|
| `orc init [--force \| --check]` | Install the kit, vault, config and `.gitignore` entry |
| `orc plan <idea.md> [--force] [--defaults]` | Questions, then the plan. `--defaults` accepts every suggested answer |
| `orc plan --check` | Validate a hand-written plan with no model call and rewrite `plan/task-graph.md` |
| `orc check-setup [--json]` | Env vars (including the API key) and the docs the plan needs |
| `orc run [--workstream <name>]...` | Run sessions until done or paused. Re-run to resume |
| `orc stop` | Stop a running `orc run` cleanly from another terminal |
| `orc integrate [--milestone <name>]` | Merge finished workstreams, run the install command and the full checks |
| `orc rewind <checkpoint> [--force]` / `--list` | Undo to a checkpoint such as `api/T3` |
| `orc summarize [--facts-only]` | Write `report.md`. `--facts-only` makes no model call |
| `orc status [--json]` | Sessions, current task, checks and estimated spend |
| `orc log <text> -s <session>` / `--tail <n>` | Append to or read the shared log |
| `orc config` | Print the resolved config |

Global options: `-c, --config <path>`, `-h`, `-v`. Command options come after the command name.

## Configuration

`orc.config.json` lives in your app's root. Every key is optional and unknown keys are errors. All defaults are in [`orc.config.example.json`](orc.config.example.json).

| Key | Default | Meaning |
|---|---|---|
| `vaultDir` | `"vault"` | Where plan, notes and logs live, relative to the config file |
| `adapter` | `"claude-agent-sdk"` | Or `"fake"` to replay `fakeScript` and spend nothing |
| `planner.model` | Opus | Asks the questions and writes the plan |
| `coder.model` | Sonnet | The coding sessions |
| `driver.model` | Haiku | Fix-or-escalate decisions and the summary narrative |
| `maxBudgetUsd` | `20` | Run-wide cap, from the SDK's estimated cost |
| `retries.maxPerTask` | `2` | Fix prompts after failed checks before escalating |
| `installCommand` | `""` | Run in the integration worktree before the checks, e.g. `"npm ci"` |
| `summaryBudgetUsd` | `0.25` | Separate cap for one `orc summarize` narrative |
| `checks[]` | typecheck, lint, test, build | Commands run after every turn, with a timeout each |

Spend figures are the Agent SDK's client-side estimate, **not billing data**. Check your Anthropic console for the real number.

## How it keeps you safe

- **Frozen contracts.** Coding sessions are told never to edit them. A wrong contract becomes a decision for you, not a silent change.
- **File ownership.** The planner splits work so no two workstreams edit the same file, which makes the final merge boring.
- **Read-only steering.** The model that decides fix-or-escalate never edits files.
- **Agents never touch the vault.** Only orc writes session notes, the log and plan checkboxes.
- **The vault is not committed** to the app's repo (`orc run` refuses a tracked vault), so secrets-adjacent notes and cost logs stay local.
- **One run at a time.** A second `orc run` in the same project is refused.

## FAQ

**Does it work with Codex, Gemini, or other agents?** Not yet. The `AgentAdapter` interface exists so they can be added; only the Claude Agent SDK adapter is implemented.

**Can I use my Claude subscription instead of an API key?** No. The Agent SDK terms do not allow third-party tools to offer claude.ai login, so orc requires `ANTHROPIC_API_KEY`.

**What stack can it build?** Anything whose checks you can express as shell commands. The defaults are `npm run typecheck`, `lint`, `test` and `build`; change `checks[]` for anything else.

**What if two workstreams really do need the same file?** The planner is told to avoid it. If it happens anyway, `orc integrate` stops on the conflict and writes it to `decisions.md`. It never picks a side.

**Why not just one long session?** Context drift, no objective "done", no parallelism, and no way to undo one wrong turn without losing the rest.

## Honest status

| Part | State |
|---|---|
| Planner, driver loop, integration, rewind, summarize, kit | Built and tested (360+ tests) against a scripted fake agent |
| Claude Agent SDK adapter | Written against the 0.3.308 type definitions; **never run live** |
| The prompts (planner, driver, summary, skills) | First drafts, **never run against a real model** |
| Time and cost numbers | **None.** Nothing has been measured |
| `/orc-*` slash commands in Claude Code, Orca, VS Code | Installed by `orc init`; **not yet tried** in those tools |

A first real run will almost certainly turn up prompt problems. Reports with the contents of `vault/LOG.md` and the session notes are gold.

## Develop

```bash
git clone https://github.com/Aryan-sk6/Orc && cd Orc
npm install
npm run check        # typecheck + lint + 360+ tests; none touch the network
npm run build
npm run demo:status  # orc status on a fake vault
npm run demo:plan    # orc plan on a todo idea with the fake adapter, no cost
```

`npm run smoke:sdk` is the one script that spends money (a few cents): three cheap turns through the real adapter. Contributor and agent conventions are in [`agents.md`](agents.md); the project's own memory (decisions, sessions, roadmap) is in [`vault/`](vault/Home.md) and opens as an Obsidian vault.

## Contributing

Issues and PRs are welcome. The most valuable contributions right now: a real run report, prompt improvements backed by a transcript, and new `AgentAdapter` implementations. Run `npm run check` before opening a PR.

## License

[MIT](LICENSE). If orc is useful to you, a star helps others find it.
