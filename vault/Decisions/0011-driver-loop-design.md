---
date: 2026-10-22
status: accepted
tags: [decision, driver, budget, m4]
---
# 0011: Driver loop: who writes what, the gate, retries, budget and resume

## Context
M4 builds the core of [[Spec]]: `orc run`, one coding session per workstream, and a driver that checks each turn. Several points were left open in [[Roadmap]], [[Open Questions]], [[0006-usd-run-cap-no-token-accounting]] and [[0010-worktrees-branches-checkpoint-tags]]. The code is in `src/driver/` and `src/checks/`.

## Decision
1. **A third model: `coder.model`** (default `claude-sonnet-5-5`). The spec's config had only a planner and a driver model, but the coding sessions need one. The driver stays on `driver.model` (Haiku).
2. **orc writes the vault, agents don't.** Each session has one writer, its own loop: session note, LOG lines (one per turn, capped at 220 characters and 8 file names), and plan checkboxes. The coding agent is told not to edit the vault. `decisions.md` is appended through `appendDecision` (mutex, one process). This realizes the ownership rule in [[Open Questions]].
3. **Context is inlined, not read from the vault.** The first prompt of a session carries the target `agents.md`, the workstream goal, owned files, definition of done, the contracts, the docs named in the workstream note, and the rules. It is the only long prompt: the session is resumed afterwards, so later task prompts are two lines. The vault stays untracked in the target repo, so worktrees have no copy to read.
4. **The gate.** After every successful coding turn all configured checks run (all of them, in order, even after a failure, so one fix prompt covers everything). Pass → `commitAll`, tick `- [ ]` to `- [x]` in the workstream note (`markTaskDone`), mark the task done on the board, and send the next task with **no model call**. A checkpoint (`orc-cp/<ws>/<task>`) is taken before each task and noted in LOG.
5. **Fail → the driver model.** One fresh read-only call on `driver.model` with: the failed checks, the agent's last summary, blocked actions, the last 30 LOG lines, the workstream note, `agents.md`, contracts and relevant docs (a doc is relevant if its name appears in the workstream note, the task, or the failure output), and the rules. It replies with one JSON block (`kit/prompts/driver.md`): `fix` with a short instruction, or `escalate` with a question, an optional default and a `reversible` flag.
   - orc sends the instruction **plus the raw check output** (tail, 3000 characters per check) to the coding agent in its existing session.
   - An unusable reply gets up to `retries.maxPerTask` repair turns in the same driver session. If it is still unusable, orc sends a plain fix prompt and logs that. A driver failure never blocks a session.
6. **Retry cap.** At most `retries.maxPerTask` fix prompts per task. A turn that ends in `max_turns` or `error` also costs one (the agent is told to continue). `refused` escalates at once. At the cap: a decision in `decisions.md` (no default), session `paused`, other sessions go on. With a cap of 0 the first failure escalates and the driver is never called.
7. **Reversible escalation.** When the driver escalates with `reversible: true` and a default, orc records the decision (open, with the default), logs that it took the default, and sends the default to the agent as its instruction. Otherwise the session pauses on the decision.
8. **Budget.** One `RunBudget` shared by all sessions and driver calls, started from the sum of every session note's `costUsd`, so earlier runs count. Each call gets `maxBudgetUsd = remaining`. When it is gone, or a turn returns `max_budget`, the session records a decision and pauses. **The remaining budget is not divided across sessions**: a cheap session would be starved by an expensive one. The overshoot is bounded by one call per active session, as noted in 0006. Planner spend is still not counted (open).
9. **Dependencies are ordering only.** A task with `needs:` waits on an event-driven `TaskBoard`. If the needed task's workstream ends without finishing it, the waiting session pauses with a decision rather than hanging. Code is not shared between worktrees until M5's integration, so workstreams must lean on the frozen contracts.
10. **Resume.** The plan checkboxes are the record of finished tasks. The session note stores `agentSession` (to resume the conversation) and `costMayBeOvercounted`, set when a restarted run resumes a session and its first turn costs something: the adapter has no earlier total to subtract, so the saved transcript total may be counted again ([[0009-claude-sdk-adapter-mapping]]). `orc status` then says so. The restart prompt reads "orc was restarted and is continuing".
11. **Stopping.** Ctrl-C or SIGTERM aborts a signal (`CliIO.signal`): running turns and checks stop, sessions end as `stopped` with no decision, exit code 130. A second Ctrl-C exits at once. There is no separate `orc stop` command yet.
12. **Crashes.** A bug or broken environment inside one session pauses that session with `crashed: …` and a note, and the others carry on.
13. **Worktree folder stays `<repo>-orc-worktrees/`**, not a config key. Worktrees are created one at a time, because concurrent `git worktree add` calls fight over lock files.

## Alternatives considered
- **Driver call on every turn.** Simple, but it costs tokens when checks pass, and the spec says no.
- **Agents write their own LOG and session notes.** Closer to "drivers communicate through the vault", but it spreads writes across processes and the model can forget or mangle the format. orc writes the same lines deterministically.
- **Dividing the budget by active sessions.** Tighter cap, but unfair, and sessions finish at different times.
- **Stop at the first failing check.** Cheaper, but the driver then sees one problem at a time.
- **A persistent driver session per workstream.** Cheaper prompts, but the context grows and cost is hard to cap. A fresh read-only call is stateless and cheap on Haiku.

## Consequences
- Tests run real git and real shell checks with scripted agents (`test/helpers/driver.ts`, `RoutedAdapter` routes by worktree so parallel sessions are deterministic).
- The live SDK path of the driver is untested, like the adapter itself ([[Open Questions]]).
- A task finished but not committed when orc is killed is redone on the next run (a new checkpoint `.2` is made).
