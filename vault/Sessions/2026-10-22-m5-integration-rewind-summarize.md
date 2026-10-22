---
date: 2026-10-22
tags: [session, m5]
---
# 2026-10-22: M5 integration, rewind, summarize

## Goal
Complete M5 from [[Roadmap]]: integration driver, `orc rewind`, `orc summarize`. M6 was not started.

## Done
- **`orc integrate`** (`src/integration/`, `src/git/integration.ts`): merges finished workstream branches into `orc-integration/<milestone>` in its own worktree, dependencies first, then `installCommand` and the full checks. Conflicts and failing checks escalate; nothing is auto-resolved. No model call. Shows up in `orc status` as session `integration`.
- **`orc rewind <checkpoint>`** (`src/rewind/`): worktree reset with backup tag, plan ticks reset, session note reset (fresh agent conversation next run), warnings for dependents and integration branches. `--list` shows checkpoints; `--force` for a killed run.
- **`orc summarize`** (`src/summarize/`, `kit/prompts/summary.md`): `vault/report.md` with a validated four-section narrative from the driver model plus deterministic tables; `--facts-only` needs no key.
- **Smaller changes:** `ensureBranchWorktree` split out of `ensureWorktree`; `installCommand` config key; vault-tracked guard on `run` and `integrate`; `orc` and `integration` reserved as workstream names; `markTasksUndoneFrom`; `report` in the vault layout.
- **Tests:** 328 pass (up from 271). Real git and real shell checks throughout.
- Decision [[0012-integration-rewind-summarize]].

## Commits
- `feat(integration)`, `feat(rewind)`, `feat(summarize)`, and `docs(vault)` for this note.

## Problems hit
- The vault-tracked error printed a path like `../../../var/folders/...` on macOS because the config path was not symlink-resolved. Fixed by resolving it before taking the repo-relative path (a test caught it).
- A test helper picked the wrong task number from the "T1 passed… Next task, T2" prompt, so two tasks wrote the same file. Test bug, fixed.
- One full `npm run check` run showed a single failing test. Follow-up the same day: 20 sequential runs were clean, but six suites in parallel failed with `Test timed out in 5000ms` in the real-git tests (plus `ENOTEMPTY` from cleanup racing them). Fixed with 30s timeouts and retrying `rm`; six parallel runs then passed 6 of 6. Recorded as D-001 in `vault/decisions.md`.

## Not verified
- **Nothing here has touched the real SDK** (no API key in this environment). The summary prompt has only been answered by a fake. `npm run smoke:sdk`, a real `orc plan`, `orc run` and `orc summarize` are still the user's to try.
- `orc integrate` on a real npm app (with `installCommand`) has not been tried; M6 will.

## Decisions
- [[0012-integration-rewind-summarize]]. Follow-up, user-confirmed: the summary stays as a third, read-only LLM call with its own fixed cap `summaryBudgetUsd` (0.25), shown in `orc status`, by hand only; [[rules]] updated. No integration fix loop.

## Next steps
- [ ] **M6:** dogfood on a todo app with 2 workstreams and write the README with real time and cost numbers. Starting points are in [[Roadmap]].
- [ ] User: run `npm run smoke:sdk`, then a small real `orc plan` / `orc run` / `orc integrate` / `orc summarize`.
