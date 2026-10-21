---
tags: [context, spec]
source: user, 2026-10-21 (verbatim)
---
# orc spec (verbatim from the user)

> [!important]
> This is the source of truth for scope. Do not edit the spec text below. Record interpretations and changes in `Decisions/`.

You are a senior TypeScript engineer. Build "orc", an open-source CLI that orchestrates AI coding sessions to build an app from one detailed plan. Phone/messaging features are OUT OF SCOPE for now.

## What orc does
1. PLAN: `orc plan <idea.md>` reads my app idea, first asks me 10-15 sharp clarifying questions in the terminal, then writes a plan into the vault:
   - architecture + folder structure
   - shared contracts (DB schema, API types, shared TS types) BEFORE any coding
   - a generated `agents.md` for the TARGET app: stack (one line per library), folder structure, styling rules and quirks, patterns to follow
   - setup checklist: accounts to create, env vars needed, packages to install (I do signups myself)
   - "docs needed" list: which current docs I must paste into vault/docs/ (e.g. Clerk, Supabase) so agents never rely on outdated training data
   - task graph split into workstreams, each with: tasks, dependencies, files it owns, definition of done
2. SETUP CHECK: `orc check-setup` verifies env vars and required docs exist, lists what's missing.
3. RUN: `orc run` creates one git worktree + branch per workstream, starts one coding session per workstream, and attaches one DRIVER agent to each session.
4. DRIVER LOOP (the core): when a session finishes a turn, deterministic checks run first (typecheck, lint, tests, build). Then the driver decides: next task / fix prompt / escalate. Driver prompts must be short and specific, like a senior dev's, built from: target agents.md, its workstream plan, contracts, relevant vault/docs, last 30 LOG lines, last turn's summary, check results. If checks pass and the next task is clear, send the next task WITHOUT a model call.
5. INTEGRATION: an integration driver merges finished workstreams into an `integration` branch per milestone and runs the full check suite.
6. SUMMARIZE: `orc summarize` reads all session notes and writes a final report.
Also: `orc status` (simple terminal table of sessions, current task, checks, tokens spent), `orc stop`, `orc rewind <checkpoint>` (git tags made before each task).

## Vault (plain markdown folder, Obsidian-compatible)
vault/LOG.md            one-line updates from every session: "[time][session] did X | touching: files"
vault/sessions/<name>.md  dedicated note per session (progress, problems, decisions)
vault/decisions.md      escalations: question, reversible default taken, status
vault/rules.md          my standing preferences, read by every driver
vault/plan/, vault/contracts/, vault/docs/
Drivers communicate ONLY through the vault.

## Hard rules
- TypeScript strict mode, no `any`, explicit interfaces. Node 20+. Minimal dependencies.
- Drive coding sessions via the Claude Agent SDK behind an `AgentAdapter` interface so Codex etc. can be added later. Do NOT guess SDK APIs: if you are unsure of the current API, stop and ask me to paste the docs into vault/docs/.
- Build a `FakeAgentAdapter` that replays scripted outputs. All tests and dev runs use it, so building orc costs almost no tokens.
- LLM calls only in planner and drivers. Everything else is deterministic code.
- Config file (orc.config.json): planner model, driver model (default small/cheap model), per-task token cap, per-run token cap, retry cap (default 2), check commands.
- On retry cap or budget cap: write to decisions.md, pause that session, continue others. If a decision is reversible, take a default, log it, keep going.
- Event-driven, never polling on a timer.
- Vitest for tests. Git commit after every completed step with clear messages.

## How to work
Build ONE milestone per session, then commit, stop, and report what you did and what's next. Do not start the next milestone.
M0: Write orc's OWN agents.md (stack, folders, patterns), project skeleton, config loader. Show me the folder structure before writing code.
M1: Vault module + LOG writer + CLI scaffolding (`orc status` on fake data).
M2: Planner (`orc plan`, `orc check-setup`), tested with FakeAgentAdapter.
M3: AgentAdapter + Claude Agent SDK adapter + git worktree/checkpoint manager.
M4: Driver loop with checks gate, budgets, retries, escalation.
M5: Integration driver + `orc summarize` + `orc rewind`.
M6: Dogfood: run orc end-to-end on a tiny sample app (todo app, 2 workstreams) and write a README with real time and token numbers.

Start with M0.

---

## Addendum 2026-10-21 (verbatim from the user)

> M7: The kit. Add a drop-in kit layer on top of the CLI: AGENTS.md/CLAUDE.md orchestrator section (main agent asks 10-15 questions, plans, never codes itself), skills/slash commands /orc-plan, /orc-run, /orc-summarize (planner and summary live here as prompts, not code), driver subagents in .claude/agents/ on a small model, and vault templates. Everything mechanical goes through `orc` CLI commands. Provide an install command (npx degit or an `orc init` that copies the kit into the current folder). Test in a fresh empty project, then in Orca and the VS Code extension.
>
> but nevertheless continue with M1.

> 1. Don't wait for me to paste. Fetch the docs yourself from the official pages and save them to vault/docs/claude-agent-sdk.md (trim to what orc needs, don't dump everything): […overview, typescript.md, agent loop, subagents, permissions…] Focus on: query() and options, how to run headless in a given working directory, how to resume a session with a new prompt, permission modes/allowlists, model selection, and how token usage is reported. Note the package name and version you read it against. If anything orc needs isn't in the docs, tell me instead of guessing.
>
> 2. Default branch: main. Do NOT push anything yet. Local commits only. I'll create the GitHub repo after M6, once the README has real numbers.

## Addendum 2026-10-21 (2) (verbatim from the user)

> 1. Simplify budgets. Drop perTaskTokens/perRunTokens enforcement. Use maxBudgetUsd as the run cap plus the retry cap, and report spend in orc status (use per-turn cost from the SDK if it provides it, otherwise say so). No custom token accounting.
> 2. Yes: require ANTHROPIC_API_KEY, and have check-setup verify it.
> 3. Agreed on the planner: one planner prompt file, run via AgentAdapter for `orc plan` and reused by /orc-plan. Move AgentAdapter and FakeAgentAdapter into M2. Keep M7 scoped as written.

These override the original "Hard rules" bullet on token caps: the config now has `maxBudgetUsd` and the retry cap, with no token caps. See [[0006-usd-run-cap-no-token-accounting]] and [[0007-shared-planner-prompt-and-api-key]].
