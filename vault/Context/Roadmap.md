---
tags: [context, roadmap]
---
# Roadmap

Build one milestone per session, then commit, stop and report. Full text is in [[Spec]].

| # | Milestone | Status | Session |
|---|---|---|---|
| M0 | orc's own `agents.md`, project skeleton, config loader | ✅ done 2026-10-21 | [[2026-10-21-m0-skeleton]] |
| M1 | Vault module, LOG writer, CLI scaffolding (`orc status` on fake data) | ⏭ next | |
| M2 | Planner (`orc plan`, `orc check-setup`), tested with FakeAgentAdapter | | |
| M3 | AgentAdapter, Claude Agent SDK adapter, git worktree/checkpoint manager | blocked on SDK docs, see [[Open Questions]] | |
| M4 | Driver loop: checks gate, budgets, retries, escalation | | |
| M5 | Integration driver, `orc summarize`, `orc rewind` | | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and token numbers | | |

## M1 starting points
- Add `src/vault/` with typed read/append helpers for `LOG.md`, `sessions/<name>.md`, `decisions.md`, `rules.md`. Inject a clock and append atomically.
- Add `src/cli/commands/` with one file per command. Move the `config` command out of `main.ts`.
- `orc status` renders a table from a fake session-state source. FakeAgentAdapter itself comes in M3, so M1 only needs fake *state*.
