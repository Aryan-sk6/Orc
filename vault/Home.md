---
tags: [index]
---
# ORC: project memory

Shared memory for every working session on ORC, whether a person or Claude runs it. Read this page first, and update it when anything important changes.

## Current state
- **Status:** M2 is done (2026-10-22). That covers `AgentAdapter` and `FakeAgentAdapter`, `orc plan` (shared prompt `kit/prompts/planner.md`, validated and repaired replies) and `orc check-setup`. The plan format is strict markdown ([[0008-plan-as-strict-markdown]]). **M3 is next:** the Claude Agent SDK adapter and the git worktree/checkpoint manager.
- **Try it:** `npm run demo:status` shows `orc status` on fake data. `npm run demo:plan` runs `orc plan` on a todo idea with the fake adapter (answer the questions or press Enter), then `cd .demo/plan && node ../../dist/cli/index.js check-setup`.
- **Branch:** `main`, local commits only. No push until after M6 ([[0004-branch-main-no-push-until-m6]]).
- **SDK docs:** [[claude-agent-sdk]] (read against 0.3.306). Its gaps feed the open questions on token caps and auth.

## Map
- [[Spec]]: the user's verbatim spec and the 2026-10-21 addendum (M7 kit)
- [[Roadmap]]: milestones M0 to M7 and their status
- [[rules]]: standing preferences for every session
- [[Overview]]: what orc is, plus the "two vaults" distinction
- [[Config]]: `orc.config.json` reference
- [[Open Questions]]: unresolved questions and blockers
- `LOG.md`: one-line log of every step (now written with `orc log -s <session>`)
- `docs/`: fetched third-party docs ([[claude-agent-sdk]])
- `Sessions/`, `Decisions/`, `Templates/`

## Recent sessions
- [[2026-10-22-m2-planner]]
- [[2026-10-21-m1-vault-cli]]
- [[2026-10-21-m0-skeleton]]
- [[2026-10-21-vault-setup]]

## Decisions
- [[0001-obsidian-vault-as-shared-memory]]
- [[0002-tooling-and-dependencies]]
- [[0003-config-shape-and-defaults]]
- [[0004-branch-main-no-push-until-m6]]
- [[0005-session-state-in-note-frontmatter]]
- [[0006-usd-run-cap-no-token-accounting]]
- [[0007-shared-planner-prompt-and-api-key]]
- [[0008-plan-as-strict-markdown]]
