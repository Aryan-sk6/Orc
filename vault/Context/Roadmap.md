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
| M5 | Integration driver, `orc summarize` (shared summary prompt file), `orc rewind` | ⏭ next | |
| M6 | Dogfood on a todo app (2 workstreams) and a README with real time and **cost** numbers | | |
| M7 | **The kit**: drop-in AGENTS.md/CLAUDE.md orchestrator section, `/orc-plan`, `/orc-run` and `/orc-summarize` skills (planner and summary as prompts), driver subagents in `.claude/agents/` on a small model, vault templates, and an install command (`orc init` or `npx degit`). Test in an empty project, then in Orca and the VS Code extension. **Scoped as written** | added 2026-10-21 | |

## M5 starting points
- **Building blocks in place:**
  - Every workstream has a branch `orc/<ws>` and a worktree in `<repo>-orc-worktrees/<ws>`. Each finished task is one commit `orc(<ws>): T<n> <title>`; checkpoints are tags `orc-cp/<ws>/<task>` (`listCheckpoints`, `findCheckpoint`).
  - `rewindToCheckpoint(worktreeRef, checkpoint)` is the primitive for `orc rewind <id>`. It needs the workstream's worktree path, which `listWorktrees` finds from the branch. A rewind should also untick the plan checkboxes after that task and reset the session note.
  - `runChecks` (`src/checks/`) runs the full suite in any directory. The integration driver can reuse it on the `integration` branch.
  - `appendDecision`, `SessionRecorder`, `RunBudget` and `loadDriverPrompt` can be reused. The integration driver is a driver too, so it gets the same budget and the same rules for pausing.
  - Session notes hold each workstream's progress, problems and decisions, plus `costUsd`. `orc summarize` reads them with `readSessionNotes`, `decisions.md` and `LOG.md`.
- **Things to decide in M5:**
  - Whether the vault is committed in the target repo. `orc run` assumes it is **untracked**: worktrees don't get a copy, and merging would not touch it. If the user commits it, the worktrees carry stale copies. Either enforce untracked (a `.gitignore` line from `orc plan`) or handle it at merge.
  - The target app's `agents.md` lives in `plan/agents.md` and is inlined into prompts. Nothing copies it to the repo root yet, so a human opening the app does not see it.
  - Merge conflicts between workstreams: escalate with a decision, or let a model resolve small ones? Workstreams own disjoint files by design (the plan validator checks it), so conflicts should be rare.
  - How `orc rewind` interacts with a running `orc run`. There is no `orc stop` command yet; Ctrl-C is the only way (see [[Open Questions]]).

## Notes for M7
- ~~Planner code or prompt?~~ Resolved by [[0007-shared-planner-prompt-and-api-key]]: one prompt file, used by both `orc plan` and `/orc-plan`. The file is `kit/prompts/planner.md`. `/orc-plan` should reuse it, but tell the agent to write the files itself instead of using the CLI's `<<<orc-file>>>` protocol, then run a validator (for example a future `orc plan --check`) ([[0008-plan-as-strict-markdown]]).
- The vault module (`src/vault/`) writes the same files the kit's templates create, so build the templates from the same constants (`VAULT_LAYOUT`) to avoid drift.
- `orc init` needs a kit directory shipped inside the npm package (`files` in package.json).
- In the SDK, subagents in `.claude/agents/` load only if the directory existed at session start (see [[claude-agent-sdk]]), so `orc init` must run before the session.

## Push policy
Local commits only on `main`. The user will create the GitHub repo after M6, once the README has real numbers. See [[0004-branch-main-no-push-until-m6]].
