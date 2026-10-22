---
tags: [context]
---
# Open questions

Record each question with the date it was raised. When it's settled, strike it through and link to the decision or session that resolved it.

- [x] ~~(2026-10-21) What is ORC?~~ Answered in [[Overview]] and [[Spec]].
- [x] ~~(2026-10-21) Default branch `main` or `master`?~~ `main`, no push until after M6. See [[0004-branch-main-no-push-until-m6]].
- [x] ~~(2026-10-21) The Claude Agent SDK docs needed pasting.~~ I fetched them myself into [[claude-agent-sdk]].
- [x] ~~(2026-10-21) Planner: code or prompt?~~ One prompt file, run through AgentAdapter, and reused by `/orc-plan`. See [[0007-shared-planner-prompt-and-api-key]].
- [x] ~~(2026-10-21) Token caps vs the SDK.~~ Dropped. The cap is now the USD `maxBudgetUsd` plus the retry cap. See [[0006-usd-run-cap-no-token-accounting]].
- [x] ~~(2026-10-21) Auth.~~ `ANTHROPIC_API_KEY` is required and verified by `check-setup`. See [[0007-shared-planner-prompt-and-api-key]].
- [x] ~~(2026-10-21) Does the planner use the Agent SDK or a plain Messages API call?~~ It goes through `AgentAdapter`, so in production that means the Agent SDK adapter (M3). M2 uses the fake.
- [ ] (2026-10-21) Should the default `maxBudgetUsd` stay at 20? Revisit with the M6 dogfood numbers.
- [x] ~~(2026-10-21) In M4, should the remaining budget be divided across active sessions?~~ No. A shared pool, with overshoot bounded by one call per active session. See [[0011-driver-loop-design]].
- [ ] (2026-10-22) Planner spend isn't recorded in any session note, so `orc status` doesn't include it. It appears in the planner's LOG line and in the `orc plan` output. Should `orc run` count it toward the run cap? (`orc run` still starts its cap from the session notes only.)
- [ ] (2026-10-22) `orc plan --force` leaves old contract files that the new plan doesn't mention. Should it clear `contracts/` too? It's reversible either way. For now it's left alone, to protect hand-written contracts.
- [ ] (2026-10-22) Should there be an `orc plan --check` that re-validates a hand-edited plan? It would be cheap, since `parsePlan` exists, and M7's `/orc-plan` needs it.
- [x] ~~(2026-10-22) Each worktree has its own copy of the committed `vault/`; how do we avoid vault merge conflicts?~~ Resolved 2026-10-22. Each session writes its own note at `vault/sessions/<session>.md` in the MAIN checkout, and only that session edits that file. Each session appends one line per turn to `vault/LOG.md`; every line is under a fixed length and written with a single atomic append. Only the orchestrator writes `decisions.md` and `rules.md`. Sessions get the absolute path to the main vault in their prompt. There is no per-worktree vault copy, and `vault/` stays out of all branches. M4 test: two sessions appending to `LOG.md` at the same time produce no interleaved lines. M5 verifies no vault file can merge-conflict. See [[0010-worktrees-branches-checkpoint-tags]].
- [x] ~~(2026-10-22) Cost deltas are tracked in memory, so after an orc restart a resumed session's first turn counts its whole saved total.~~ Resolved 2026-10-22. Store the running cost total in the session note after every turn. On resume, use the SDK's reported total if available; otherwise keep the conservative overcount and show "spend may be overcounted after restart" in `orc status`. See [[0009-claude-sdk-adapter-mapping]]. Built in M4 ([[0011-driver-loop-design]]): `agentSession` and `costMayBeOvercounted` in the session note, and the `orc status` warning.
- [ ] (2026-10-22) The live SDK adapter is untested (no key in the build environment). Run `npm run smoke:sdk`, then try `orc plan` on a real idea, then a small `orc run` with a low `maxBudgetUsd`. The driver loop and its prompts have only run against the fake adapter.
- [ ] (2026-10-22) There is no `orc stop` command. Ctrl-C (or SIGTERM to the `orc run` process) stops cleanly. A separate command would need a pid file. Build it only if wanted.
- [x] ~~(2026-10-22) Should `orc run` refuse to start when `vault/` is tracked in git?~~ Yes, `orc run` and `orc integrate` do (`VAULT_TRACKED`). See [[0012-integration-rewind-summarize]].
- [ ] (2026-10-22) When a task's checks keep failing, the driver sees only the last turn's summary and failures. Does it need the earlier fix attempts too? Revisit with real runs in M6.
- [ ] (2026-10-21) Case-insensitive filesystem risk: this vault has `Sessions/`, while the runtime vault uses `sessions/`. That's fine as long as orc never targets its own repo. Keep it in mind for M6 dogfooding.
- [ ] (2026-10-22) **Needs the user:** `orc summarize` makes a third LLM caller (`src/summarize/`), while [[rules]] says LLM calls happen only in the planner and drivers. I built it because the roadmap asks for a shared summary prompt file, and left the rule text as written. Confirm, or ask for a deterministic-only summary. See [[0012-integration-rewind-summarize]].
- [ ] (2026-10-22) Summary spend, like the planner's, is not in any session note, so it does not count toward the run cap in later runs. Count both, or leave it (they are cents)?
- [ ] (2026-10-22) When integration checks fail, orc only escalates. Should a driver-model fix loop (like the per-workstream one) be added? Decide after M6 shows how often it happens.
- [ ] (2026-10-22) `orc integrate` has no way to know whether the integration worktree needs a fresh install; it runs `installCommand` every time. Fine for `npm ci` on small apps; revisit if slow.
- [ ] (2026-10-22) The target app's `agents.md` is still only in `plan/agents.md`, not at the repo root of the app (carried over from the M5 starting points). Copy it in `orc plan`, or in M7's `orc init`?
- [ ] (2026-10-22) `orc rewind` cannot undo an integration merge; it only warns. Add `orc integrate --reset` (recreate the branch from HEAD) if rewinds turn out to be common.
