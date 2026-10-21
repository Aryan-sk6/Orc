---
tags: [index]
---
# ORC: project memory

Shared memory for every working session on ORC, whether a person or Claude runs it. Read this page first, and update it when anything important changes.

## Current state
- **Status:** M0 is done (2026-10-21). That covers `agents.md`, the skeleton and the config loader. M1 is next.
- **Remote:** https://github.com/Aryan-sk6/Orc. The branch is `master` and nothing has been pushed yet.
- **Blocker for M3:** the Claude Agent SDK docs need pasting into `docs/` (see [[Open Questions]]).

## Map
- [[Spec]]: the user's verbatim spec, the source of truth
- [[Roadmap]]: milestones M0 to M6 and their status
- [[rules]]: standing preferences for every session
- [[Overview]]: what orc is, plus the "two vaults" distinction
- [[Config]]: `orc.config.json` reference
- [[Open Questions]]: unresolved questions and blockers
- `LOG.md`: one-line log of every step
- `docs/`: pasted third-party docs (see `docs/README.md` for what's needed)
- `Sessions/`, `Decisions/`, `Templates/`

## Recent sessions
- [[2026-10-21-m0-skeleton]]
- [[2026-10-21-vault-setup]]

## Decisions
- [[0001-obsidian-vault-as-shared-memory]]
- [[0002-tooling-and-dependencies]]
- [[0003-config-shape-and-defaults]]
