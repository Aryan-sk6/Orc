---
tags: [context, roadmap]
---
# Roadmap

Build one milestone per session, then commit, stop and report. Full text is in [[Spec]], including both 2026-10-21 addenda.

| # | Milestone | Status | Session |
|---|---|---|---|
| M0 | orc's own `agents.md`, project skeleton, config loader | ✅ done 2026-10-21 | [[2026-10-21-m0-skeleton]] |
| M1 | Vault module, LOG writer, CLI scaffolding (`orc status` on fake data) | ✅ done 2026-10-21. Budgets switched to a USD run cap afterwards ([[0006-usd-run-cap-no-token-accounting]]) | [[2026-10-21-m1-vault-cli]] |
| M2 | **`AgentAdapter` interface and `FakeAgentAdapter`**, plus the planner: one planner prompt file run through the adapter (`orc plan`), and `orc check-setup` (env vars including `ANTHROPIC_API_KEY`, and required docs) | ✅ done 2026-10-22. Plan format: [[0008-plan-as-strict-markdown]] | [[2026-10-22-m2-planner]] |
| M3 | Claude Agent SDK adapter (implements `AgentAdapter`), git worktree/checkpoint manager | ⏭ next. SDK docs fetched ([[claude-agent-sdk]]) | |
| M4 | Driver loop: checks gate, USD run cap (`maxBudgetUsd`), retry cap, escalation | | |
| M5 | Integration driver, `orc summarize` (shared summary prompt file), `orc rewind` | | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and **cost** numbers | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension. **Scoped as written** | added 2026-10-21 | |

## M3 starting points
- `src/agents/claude-sdk.ts` implements `AgentAdapter` (`src/agents/adapter.ts`). It's the **only** file that imports `@anthropic-ai/claude-agent-sdk`. Adding the dependency needs a decision note.
- Map `AgentAccess`: `"read-only"` to a fixed read-only surface (the planner runs this way), and `"edit"` to `acceptEdits` plus allowlisted check commands. Verify against [[claude-agent-sdk]] and don't guess.
- `costUsd` must be **per turn**. The SDK's `total_cost_usd` is cumulative on resume, so subtract the previous total for the same session. Keep the previous value when an `error_during_execution` result reports zeros ([[0006-usd-run-cap-no-token-accounting]]).
- Map outcomes: `success` (also check `is_error`), `error_max_turns` → `max_turns`, `error_max_budget_usd` → `max_budget`, `stop_reason === "refusal"` → `refused`, anything else → `error`, with `errors[]` copied over.
- Once it works, `createAdapter` returns it for `"claude-agent-sdk"`. Its test must not hit the network.
- Git worktree/checkpoint manager in `src/git/`: one worktree and branch per workstream (names come from `plan/workstreams/<name>.md`), and a tag before each task for `orc rewind`.

## Notes for M7
- ~~Planner code or prompt?~~ Resolved by [[0007-shared-planner-prompt-and-api-key]]: one prompt file, used by both `orc plan` and `/orc-plan`. The file is `kit/prompts/planner.md`. `/orc-plan` should reuse it, but tell the agent to write the files itself instead of using the CLI's `<<<orc-file>>>` protocol, then run a validator (for example a future `orc plan --check`) ([[0008-plan-as-strict-markdown]]).
- The vault module (`src/vault/`) writes the same files the kit's templates create, so build the templates from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
