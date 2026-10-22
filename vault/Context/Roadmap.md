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
| M3 | Claude Agent SDK adapter (implements `AgentAdapter`), git worktree/checkpoint manager | ✅ done 2026-10-22. [[0009-claude-sdk-adapter-mapping]], [[0010-worktrees-branches-checkpoint-tags]] | [[2026-10-22-m3-sdk-adapter-git]] |
| M4 | Driver loop: checks gate, USD run cap (`maxBudgetUsd`), retry cap, escalation | ✅ done 2026-10-22. [[0011-driver-loop-design]] | [[2026-10-22-m4-driver-loop]] |
| M5 | Integration driver, `orc summarize` (shared summary prompt file), `orc rewind` | ✅ done 2026-10-22. [[0012-integration-rewind-summarize]] | [[2026-10-22-m5-integration-rewind-summarize]] |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and **cost** numbers | ⏭ next | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension. **Scoped as written** | added 2026-10-21 | |

## M6 starting points
- **Nothing has run against the real SDK yet.** Before the dogfood: `npm run smoke:sdk`, then `orc plan` on the todo idea, `orc check-setup`, then `orc run` with a low `maxBudgetUsd`. Expect to fix prompts (first-task, fix, driver, summary) after reading real transcripts.
- **Commands to time and cost:** `orc plan`, `orc run`, `orc integrate`, `orc summarize`. Cost sources: `orc status` (session notes), the `orc plan` output and the report's `summaryCostUsd`. Planner and summary spend are not in the run cap ([[Open Questions]]).
- **Set `installCommand`** (for example `"npm ci"`) in the todo app's `orc.config.json`, or `orc integrate` runs the checks without `node_modules`. The coding sessions' own worktrees need their dependencies installed by the agent (put it in the first task of the plan).
- **The vault must not be tracked** in the todo app's repo: `orc run` refuses otherwise ([[0012-integration-rewind-summarize]]). Add `vault/` to its `.gitignore`.
- **Still open:** the target app's `agents.md` lives in `plan/agents.md` and is never copied to the repo root; an LLM fix loop for failing integration; `orc stop`; whether planner and summary spend should count toward the cap.
- **README:** commands, the two vaults, config, the numbers from the dogfood. Push policy: [[0004-branch-main-no-push-until-m6]].

## Notes for M7
- Anything automated that writes a report (a `/orc-run` finish step, hooks) must call `orc summarize --facts-only`. The narrative is for a person typing `orc summarize`. Its cost is capped separately by `summaryBudgetUsd` ([[0012-integration-rewind-summarize]]).
- ~~Planner code or prompt?~~ Resolved by [[0007-shared-planner-prompt-and-api-key]]: one prompt file, used by both `orc plan` and `/orc-plan`. The file is `kit/prompts/planner.md`. `/orc-plan` should reuse it, but tell the agent to write the files itself instead of using the CLI's `<<<orc-file>>>` protocol, then run a validator (for example a future `orc plan --check`) ([[0008-plan-as-strict-markdown]]).
- The vault module (`src/vault/`) writes the same files the kit's templates create, so build the templates from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
