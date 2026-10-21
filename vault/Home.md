---
tags: [index]
---
# ORC: project memory

Shared memory for every working session on ORC, whether a person or Claude runs it. Read this page first, and update it when anything important changes.

## Current state
- **Status:** M1 is done (2026-10-21). That covers the vault module, the LOG writer, and `orc status`/`orc log`/`orc config`. Budgets are now a USD run cap ([[0006-usd-run-cap-no-token-accounting]]). **M2 is next and unblocked:** AgentAdapter, FakeAgentAdapter, the shared planner prompt and check-setup ([[0007-shared-planner-prompt-and-api-key]]).
- **Try it:** run `npm run demo:status` for `orc status` on fake data.
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
