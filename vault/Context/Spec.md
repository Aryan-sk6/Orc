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
