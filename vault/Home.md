---
tags: [index]
---
# ORC: project memory

Shared memory for every working session on ORC, whether a person or Claude runs it. Read this page first, and update it when anything important changes.

## Current state
- **Status:** M5 is done (2026-10-22): `orc integrate`, `orc rewind` and `orc summarize` ([[0012-integration-rewind-summarize]]). Everything so far has run only against the fake adapter, so the real-SDK path and all prompts are untried. M4 gave the driver loop and `orc run` ([[0011-driver-loop-design]]); M3 the SDK adapter ([[0009-claude-sdk-adapter-mapping]]) and git worktrees/checkpoints ([[0010-worktrees-branches-checkpoint-tags]]). **M6 is prep only, and the user will not do the live run (2026-10-22):** dogfood script and README exist, but the live run needs `ANTHROPIC_API_KEY` and hasn't happened ([[2026-10-22-m6-dogfood-prep]]). The summary is a third, read-only LLM call with its own cap ([[0012-integration-rewind-summarize]]).
- **M7 built (2026-10-22, prep-level):** `orc init` installs the kit (`/orc-plan`, `/orc-run`, `/orc-summarize`, `orc-driver` subagent, AGENTS.md/CLAUDE.md block, vault templates); `orc plan --check` validates a plan with no model call ([[0013-kit-and-orc-init]]). Untested inside Claude Code / Orca / VS Code ([[2026-10-22-m7-kit]]).
- **Release prep (2026-10-22):** npm package name is `orc-agents` (`orc` is taken; `orc-cli` was rejected as too similar to opn-cli), version 0.1.0, command `orc`; public README rewritten; LICENSE (MIT) added; remote `origin` is https://github.com/Aryan-sk6/Orc.git. Publish and push are user-authorised but need `npm login` first.
- **Try it:** `orc integrate` merges finished workstreams (set `installCommand` first), `orc rewind --list` / `orc rewind api/T3`, `orc summarize --facts-only` needs no key. `orc run` needs a plan, a passing `orc check-setup` and a git repo with a commit; with `adapter: "fake"` it spends nothing. `npm run demo:status` shows `orc status` on fake data. `npm run demo:plan` runs `orc plan` on a todo idea with the fake adapter (answer the questions or press Enter), then `cd .demo/plan && node ../../dist/cli/index.js check-setup`. `npm run smoke:sdk` is a **live** check of the SDK adapter: it spends a few cents and needs the key. It hasn't been run yet. `npm run dogfood:setup` then `node scripts/dogfood.mjs time <orc args>` (see README) is the live M6 run.
- **Branch:** `main`, pushed to https://github.com/Aryan-sk6/Orc on 2026-10-22 at the user's request, before any live run (M6 skipped; the README says so). Originally: no push until after M6 ([[0004-branch-main-no-push-until-m6]]).
- **SDK docs:** [[claude-agent-sdk]] (read against 0.3.306; installed and re-verified against 0.3.308).

## Map
- [[Spec]]: the user's verbatim spec and the 2026-10-21 addendum (M7 kit)
- [[Roadmap]]: milestones M0 to M7 and their status
- [[rules]]: standing preferences for every session
- [[Overview]]: what orc is, plus the "two vaults" distinction
- [[Config]]: `orc.config.json` reference
- [[Open Questions]]: unresolved questions and blockers
- `LOG.md`: one-line log of every step (now written with `orc log -s <session>`)
- `docs/`: fetched third-party docs ([[claude-agent-sdk]], [[claude-code-kit-formats]])
- `Sessions/`, `Decisions/`, `Templates/`

## Recent sessions
- [[2026-10-22-m7-kit]]
- [[2026-10-22-m6-dogfood-prep]]
- [[2026-10-22-m5-integration-rewind-summarize]]
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
- [[0012-integration-rewind-summarize]]
- [[0013-kit-and-orc-init]]
