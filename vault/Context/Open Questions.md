---
tags: [context]
---
# Open questions

Record each question with the date it was raised. When it's settled, strike it through and link to the decision or session that resolved it.

- [x] ~~(2026-10-21) What is ORC?~~ Answered in [[Overview]] and [[Spec]].
- [ ] (2026-10-21) Should the default branch be `main` or `master`? It's currently `master`, and nothing has been pushed to `origin` yet.
- [ ] (2026-10-21) **Blocks M3:** the Claude Agent SDK TypeScript docs need to be pasted into `docs/claude-agent-sdk.md`. Per the rules, SDK APIs are never guessed.
- [ ] (2026-10-21) Does the planner (M2) call the model through the Agent SDK or through a plain Messages API call? Either way it goes through `AgentAdapter`, but this changes which docs are needed.
- [ ] (2026-10-21) Token cap semantics (M4): do caps count input plus output? Cached reads? Driver tokens? The current defaults (500k per task, 10M per run) are placeholders. See [[0003-config-shape-and-defaults]].
- [ ] (2026-10-21) Case-insensitive filesystem risk: this vault has `Sessions/`, and the runtime vault spec uses `sessions/`. That's fine as long as orc never targets its own repo. Keep it in mind for M6 dogfooding.
