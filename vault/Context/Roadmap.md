---
tags: [context, roadmap]
---
# Roadmap

Build one milestone per session, then commit, stop and report. Full text is in [[Spec]], including both 2026-10-21 addenda.

| # | Milestone | Status | Session |
|---|---|---|---|
| M0 | orc's own `agents.md`, project skeleton, config loader | ✅ done 2026-10-21 | [[2026-10-21-m0-skeleton]] |
| M1 | Vault module, LOG writer, CLI scaffolding (`orc status` on fake data) | ✅ done 2026-10-21. Budgets switched to a USD run cap afterwards ([[0006-usd-run-cap-no-token-accounting]]) | [[2026-10-21-m1-vault-cli]] |
| M2 | **`AgentAdapter` interface and `FakeAgentAdapter`**, plus the planner: one planner prompt file run through the adapter (`orc plan`), and `orc check-setup` (env vars including `ANTHROPIC_API_KEY`, and required docs) | ⏭ next. Unblocked | |
| M3 | Claude Agent SDK adapter (implements `AgentAdapter`), git worktree/checkpoint manager | SDK docs fetched ([[claude-agent-sdk]]) | |
| M4 | Driver loop: checks gate, USD run cap (`maxBudgetUsd`), retry cap, escalation | | |
| M5 | Integration driver, `orc summarize` (shared summary prompt file), `orc rewind` | | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and **cost** numbers | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension. **Scoped as written** | added 2026-10-21 | |

## M2 starting points
- `src/agents/adapter.ts` defines `AgentAdapter`. Keep it SDK-agnostic: start or resume a session in a `cwd` with a prompt, get events or a final result (text, session id, `costUsd` for the turn), and close. Shape it on what [[claude-agent-sdk]] shows (`query()`, `resume`, `result.total_cost_usd`), but **never import the SDK** in this file.
- `src/agents/fake.ts` defines `FakeAgentAdapter`, which replays scripted outputs (including cost) so tests spend no tokens.
- The planner prompt file is shared with M7's `/orc-plan` ([[0007-shared-planner-prompt-and-api-key]]). Pick a location that ships in the npm package.
- `orc check-setup` is deterministic and checks presence only, with no network calls.

## Notes for M7
- ~~Planner code or prompt?~~ Resolved by [[0007-shared-planner-prompt-and-api-key]]: one prompt file, used by both `orc plan` and `/orc-plan`.
- The vault module (`src/vault/`) writes the same files the kit's templates create, so build the templates from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
