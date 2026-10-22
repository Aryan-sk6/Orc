---
date: 2026-10-22
tags: [session, m4]
---
# 2026-10-22: M4 driver loop

## Goal
Complete M4 from [[Roadmap]]: the driver loop with the checks gate, USD run cap, retry cap and escalation. M5 was not started; it depends on this.

## Done
- **`src/checks/run-checks.ts`:** runs each configured command in a shell inside the worktree, in its own process group. Timeout and abort kill the whole group. Output keeps its tail. Waits on the child's `close` event.
- **`src/driver/`:** see [[0011-driver-loop-design]].
  - `session.ts`: one workstream's loop. Checkpoint → coding turn → checks → next task (no model call) | driver fix prompt | escalate.
  - `run.ts`: worktrees, restored state, shared `RunBudget`, `TaskBoard` for `needs:`, all sessions in parallel. A crash pauses one session only.
  - `prompts.ts`, `context.ts`, `reply.ts`, `recorder.ts`, `budget.ts`, `board.ts`.
- **`kit/prompts/driver.md`:** the driver's instructions (fix or escalate, JSON reply). Shared with M7's driver subagents.
- **`orc run [--workstream <name>]`:** checks the plan and setup first (the API key only for the real adapter), prints progress and a summary, exits 0 done / 1 paused / 130 stopped.
- **Smaller changes:** `coder.model` config key; `agentSession` and `costMayBeOvercounted` in the session note, with an `orc status` warning; `markTaskDone` in `src/vault/plan.ts`; `changedFiles` in `src/git/`; `CliIO.signal` with Ctrl-C handling in the bin.
- **Tests:** 271 pass (up from 196). The driver tests use real git and real shell checks with scripted agents. They cover: the happy path, fix prompts, repair of bad driver replies, retry cap, reversible and irreversible escalation, `max_turns`, refusal, a crashed session, the budget cap and a resume, driver calls counting toward the cap, dependencies and blocking, concurrent LOG appends (no interleaved lines), and abort. I also ran the built `orc run` once by hand in a scratch repo.

## Commits
- `feat(checks)`: check runner
- `feat(driver)`: driver loop, `orc run` and the supporting changes
- `docs(vault)`: this note, decision 0011, roadmap

## Problems hit
- A test assumed T2 would produce a commit; it changed nothing (the marker file already existed), so `commitAll` correctly returned null. Fixed the test, not the code.
- Cost sums showed float noise (`0.21000000000000002`). The recorder now rounds on every update.
- After a restart the next prompt said "T1 passed all checks" for a task finished in an earlier run. It now says orc was restarted.

## Not verified
- **Nothing here has touched the real SDK.** There is no `ANTHROPIC_API_KEY` in this environment, so the driver loop has only run against the fake adapter. `npm run smoke:sdk` and a real `orc plan` / `orc run` are still the user's to try.
- The prompts (first task, fix, driver) have never been seen by a real model. Their wording is a first draft.

## Decisions
- [[0011-driver-loop-design]]

## Next steps
- [ ] **M5:** integration driver (merge finished workstream branches into an `integration` branch per milestone, run the full suite), `orc summarize`, `orc rewind`. Starting points are in [[Roadmap]].
- [ ] User: run `npm run smoke:sdk`, then `orc plan` and a small `orc run` with a key and a low `maxBudgetUsd`.
