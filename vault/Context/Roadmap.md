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
| M4 | Driver loop: checks gate, USD run cap (`maxBudgetUsd`), retry cap, escalation | ⏭ next | |
| M5 | Integration driver, `orc summarize` (shared summary prompt file), `orc rewind` | | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and **cost** numbers | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension. **Scoped as written** | added 2026-10-21 | |

## M4 starting points
- **Building blocks in place:**
  - `ClaudeSdkAdapter.runTurn` takes `access: "edit"`, `allowedCommands` (pass the configured check commands), `projectRoot` (the main checkout, when `cwd` is a worktree), `resumeSessionId`, and `maxBudgetUsd` (the remaining run budget).
  - Its result has a per-turn `costUsd`, an `outcome`, and `deniedActions`, which can feed straight into the next fix prompt.
- **Git** (`src/git/`):
  - `openRepo(rootDir, env)` → `ensureWorktree(repo, {name, worktreesDir: defaultWorktreesDir(repo.root)})` for each workstream.
  - `createCheckpoint(wt, {workstream, task})` before each task, with a LOG line naming the checkpoint id.
  - `commitAll(wt, msg)` after each turn whose checks pass.
- **The plan:** `parsePlan()` gives tasks, `needs` and owned files without a model call. A task can start once its `needs` are done.
- **Things to decide in M4:**
  - Where LOG and session notes are written. They must go to the main checkout's vault, not the worktree copies. See [[Open Questions]].
  - Whether to persist the adapter's last cost total per session, so a resume after a restart doesn't overcount ([[0009-claude-sdk-adapter-mapping]]).
  - Whether to split the remaining budget across parallel sessions.
  - Whether the worktree folder becomes a config key.
- **Checks:** `src/checks/` runs the configured commands with `timeoutMs`, using child-process exit events and no polling.

## Notes for M7
- ~~Planner code or prompt?~~ Resolved by [[0007-shared-planner-prompt-and-api-key]]: one prompt file, used by both `orc plan` and `/orc-plan`. The file is `kit/prompts/planner.md`. `/orc-plan` should reuse it, but tell the agent to write the files itself instead of using the CLI's `<<<orc-file>>>` protocol, then run a validator (for example a future `orc plan --check`) ([[0008-plan-as-strict-markdown]]).
- The vault module (`src/vault/`) writes the same files the kit's templates create, so build the templates from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
