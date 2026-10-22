---
date: 2026-10-22
tags: [session, m6]
---
# 2026-10-22: M6 prep (dogfood script and README)

## Goal
M6 from [[Roadmap]]: dogfood on a todo app with a README of real time and cost numbers.

## Done
- No `ANTHROPIC_API_KEY` in this environment, so the live dogfood could not run. The user chose: prepare everything that needs no key, and they run it live.
- `scripts/dogfood.mjs`: `setup` creates `.dogfood/todo-app` (git repo with one commit, `vault/` ignored, config with `maxBudgetUsd` 3 and `installCommand` `npm install`, an `idea.md` that asks for two workstreams `api` and `web` and an install task first). `time <orc args>` runs orc in the app and appends wall seconds and exit code to `.dogfood/numbers.tsv`. `npm run dogfood:setup`; `.dogfood/` is gitignored.
- Checked without spending: setup runs, `orc config` resolves, `orc check-setup` reports the missing key.
- `README.md` (new): how it works, commands, config, the two vaults, the dogfood steps, and a **numbers table left empty on purpose**.
- `npm run check` passes (328 tests).

## Not done / not verified
- **M6 is not complete.** Nothing ran against the real SDK: no `smoke:sdk`, `orc plan`, `orc run`, `orc integrate` or `orc summarize`. No prompt was tuned from real transcripts. The README has no measured numbers and must not get any until they are measured.
- The idea's "plan exactly two workstreams" hint is untested against the planner prompt.

## Next steps
- [ ] User: `export ANTHROPIC_API_KEY=...`, then `npm run smoke:sdk`, `npm run dogfood:setup`, and the `time` commands listed in the README.
- [ ] Next session: read the transcripts, fix prompts, fill the README table from `orc status` and `.dogfood/numbers.tsv`, settle the open questions that need real data (default `maxBudgetUsd`, fix-attempt history, integration failures), then push policy ([[0004-branch-main-no-push-until-m6]]).

## Fake-adapter end-to-end run (added same day)
Ran `plan --defaults`, `check-setup`, `run`, `integrate`, `summarize --facts-only`, `status` on the planner fixture with the fake adapter (scratch copy in `.dogfood/fake`, gitignored). Plan, check-setup, run (both workstreams, cross-workstream waits, 5/5 tasks) and summarize worked. **`integrate` failed to merge anything** on the mutual task-level dependency; see [[Open Questions]]. Costs shown ($0.35 plan, $0.05 run) are scripted fake numbers, not real.
