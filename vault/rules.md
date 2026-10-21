---
tags: [rules]
---
# Standing rules

These are the user's standing preferences. Every session building orc reads them. They are copied from the hard rules in [[Spec]] and grow as the user adds more.

- TypeScript strict, no `any`, explicit interfaces. Node 20+. Minimal dependencies.
- Drive coding sessions through `AgentAdapter`. The Claude Agent SDK implementation comes first.
- **Never guess SDK APIs.** If you're unsure, stop and ask the user to paste docs into `vault/docs/`.
- `FakeAgentAdapter` replays scripted output. All tests and dev runs use it.
- LLM calls happen only in the planner and drivers. Everything else is deterministic.
- On a retry cap or budget cap: write to `decisions.md`, pause that session, and keep the others running. For reversible decisions, take a default, log it and carry on.
- Event-driven code only. Never poll on a timer.
- Use Vitest. Commit after every completed step, with clear messages.
- Build one milestone per session, then commit, stop and report. Don't start the next milestone.
- Update this vault freely as you work, since the user asked for that.
