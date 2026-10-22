---
tags: [index]
---
# ORC: project memory

Shared memory for every working session on ORC, whether a person or Claude runs it. Read this page first, and update it when anything important changes.

## Current state
- **Status:** M4 is done (2026-10-22): the driver loop (`src/driver/`, `src/checks/`, [[0011-driver-loop-design]]) and `orc run`. It has only run against the fake adapter, so the real-SDK path and the prompts are untried. M3 gave the SDK adapter ([[0009-claude-sdk-adapter-mapping]]) and git worktrees/checkpoints ([[0010-worktrees-branches-checkpoint-tags]]). **M5 is next:** integration driver, `orc summarize`, `orc rewind`.
- **Try it:** `orc run` needs a plan, a passing `orc check-setup` and a git repo with a commit; with `adapter: "fake"` it spends nothing. `npm run demo:status` shows `orc status` on fake data. `npm run demo:plan` runs `orc plan` on a todo idea with the fake adapter (answer the questions or press Enter), then `cd .demo/plan && node ../../dist/cli/index.js check-setup`. `npm run smoke:sdk` is a **live** check of the SDK adapter: it spends a few cents and needs the key. It hasn't been run yet.
- **Branch:** `main`, local commits only. No push until after M6 ([[0004-branch-main-no-push-until-m6]]).
- **SDK docs:** [[claude-agent-sdk]] (read against 0.3.306; installed and re-verified against 0.3.308).

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
- [[2026-10-22-m4-driver-loop]]
- [[2026-10-22-m3-sdk-adapter-git]]
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
- [[0009-claude-sdk-adapter-mapping]]
- [[0010-worktrees-branches-checkpoint-tags]]
- [[0011-driver-loop-design]]
