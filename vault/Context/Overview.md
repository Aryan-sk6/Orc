---
tags: [context]
---
# ORC overview

**orc** is an open-source TypeScript CLI that orchestrates AI coding sessions to build an app from one detailed plan. The full spec is in [[Spec]], and milestones and status are in [[Roadmap]].

## How it works
1. `orc plan idea.md` asks clarifying questions, then writes the plan into the target app's vault: architecture, contracts, the target's `agents.md`, a setup checklist, the docs needed, and a workstream task graph.
2. `orc check-setup` reports missing env vars and docs.
3. `orc run` gives each workstream its own git worktree and branch, its own coding session, and its own **driver** agent.
4. The driver loop runs deterministic checks first (typecheck, lint, test, build). It then chooses the next task, a fix prompt, or escalation. When the checks pass and the next task is clear, it makes no model call.
5. The integration driver merges finished workstreams into `integration` for each milestone.
6. `orc summarize`, `orc status`, `orc stop` and `orc rewind <checkpoint>` round out the commands.

## Goals
- Build an app from one plan, with workstreams running in parallel.
- Keep token use low: LLM calls happen only in the planner and drivers, and dev and test runs replay scripted output through `FakeAgentAdapter`.
- Drivers coordinate only through the target's vault, which is plain markdown and works in Obsidian.

## Non-goals (for now)
- Phone or messaging features.
- Agent backends other than the Claude Agent SDK. The `AgentAdapter` interface leaves room for Codex and others later.

## Stack
See `agents.md` at the repo root (one line per library) and [[0002-tooling-and-dependencies]].

## Two vaults, don't confuse them
- **`ORC/vault/`** (this vault) holds memory for developing orc itself: sessions, decisions and context.
- **The target app's vault** is what orc creates and reads at runtime inside the app it builds. It contains `LOG.md`, `sessions/`, `decisions.md`, `rules.md`, `plan/`, `contracts/` and `docs/`. Its location is set by `vaultDir` in `orc.config.json`.

This vault also uses some of the runtime layout (`LOG.md`, `rules.md`, `docs/`) to try the format out on ourselves.

## Related
- [[Home]]
