---
tags: [context]
---
# Open questions

Record each question with the date it was raised. When it's settled, strike it through and link to the decision or session that resolved it.

- [x] ~~(2026-10-21) What is ORC?~~ Answered in [[Overview]] and [[Spec]].
- [x] ~~(2026-10-21) Default branch `main` or `master`?~~ `main`, no push until after M6. See [[0004-branch-main-no-push-until-m6]].
- [x] ~~(2026-10-21) The Claude Agent SDK docs needed pasting.~~ I fetched them myself into [[claude-agent-sdk]].
- [ ] (2026-10-21) **Needed before M2. Planner: code or prompt?** M7 says the planner and summary "live as prompts, not code" in the `/orc-plan` and `/orc-summarize` skills. M2 says `orc plan` is tested with FakeAgentAdapter. My suggestion: in M2, `orc plan` runs the planner prompt through `AgentAdapter` (so it's testable with the fake), and the prompt text lives in a kit file that M7's skill reuses. That way there's one prompt and two entry points.
- [ ] (2026-10-21) **Needed before M4. Token caps vs the SDK.** The SDK's only hard cap is `maxBudgetUsd` (USD, estimated). There's no token-denominated hard cap, and `taskBudget` is alpha and advisory. Proposal: orc enforces `perTaskTokens`/`perRunTokens` itself at turn boundaries, using `result.modelUsage` deltas (input + output + cache creation, excluding cache reads?), and also passes a derived `maxBudgetUsd` as a hard backstop. The user should confirm what counts as a token.
- [ ] (2026-10-21) **Auth.** The SDK docs bar third-party products from offering claude.ai login. Should orc require `ANTHROPIC_API_KEY` (or a cloud provider) and have `check-setup` verify it?
- [ ] (2026-10-21) Does the planner (M2) use the Agent SDK or a plain Messages API call? Either way it goes through `AgentAdapter`. This depends on the code-or-prompt answer above.
- [ ] (2026-10-21) Case-insensitive filesystem risk: this vault has `Sessions/`, while the runtime vault uses `sessions/`. That's fine as long as orc never targets its own repo. Keep it in mind for M6 dogfooding.
