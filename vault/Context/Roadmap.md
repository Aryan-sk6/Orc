---
tags: [context, roadmap]
---
# Roadmap

Build one milestone per session, then commit, stop and report. Full text is in [[Spec]], including the 2026-10-21 addendum.

| # | Milestone | Status | Session |
|---|---|---|---|
| M0 | orc's own `agents.md`, project skeleton, config loader | ✅ done 2026-10-21 | [[2026-10-21-m0-skeleton]] |
| M1 | Vault module, LOG writer, CLI scaffolding (`orc status` on fake data) | 🚧 in progress | |
| M2 | Planner (`orc plan`, `orc check-setup`), tested with FakeAgentAdapter | | |
| M3 | AgentAdapter, Claude Agent SDK adapter, git worktree/checkpoint manager | SDK docs fetched ([[claude-agent-sdk]]) | |
| M4 | Driver loop: checks gate, budgets, retries, escalation | | |
| M5 | Integration driver, `orc summarize`, `orc rewind` | | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and token numbers | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension | added 2026-10-21 | |

## Notes for M7 (from the M1 session)
- M7 moves the planner and summarizer **out of code and into prompts**, which overlaps M2 and M5. Before M2 starts, decide whether `orc plan` in M2 becomes a thin CLI that the `/orc-plan` skill calls for the mechanical steps, or whether it stays a code-driven planner. See [[Open Questions]].
- The M1 vault module (`src/vault/`) writes the same files the kit's templates create, so the templates should come from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
