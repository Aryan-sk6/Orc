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
- [ ] (2026-10-21) In M4, should the remaining budget be divided across active sessions to limit parallel overshoot? See the limits in [[0006-usd-run-cap-no-token-accounting]].
- [ ] (2026-10-21) Case-insensitive filesystem risk: this vault has `Sessions/`, while the runtime vault uses `sessions/`. That's fine as long as orc never targets its own repo. Keep it in mind for M6 dogfooding.
