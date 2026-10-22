---
name: orc-run
description: Run the plan with orc: one git worktree and coding session per workstream, with checks, retries and escalation. Spends money; only run when the user asks.
argument-hint: [--workstream <name>]
disable-model-invocation: true
allowed-tools: Bash(orc *) Read
---

You are running `/orc-run $ARGUMENTS`. You do not write code; `orc run` does the coding through its own sessions.

1. `orc plan --check`, then `orc check-setup`. If either fails, show the problems and stop: the user must fix them.
2. Show `orc config` (models and `maxBudgetUsd`) and say the run can spend up to that cap. If the user did not already ask for a run in this conversation, ask first.
3. Run `orc run $ARGUMENTS`. It blocks until every session is done, paused or stopped, so run it in the background if you can, and report `orc status` when it ends. Ctrl-C stops it cleanly.
4. Exit 0: all done. Suggest `orc integrate`. Exit 1: something paused. Read `{{vault}}/decisions.md` and `orc status`, tell the user each open decision and what orc needs, and do not answer them yourself. Exit 130: the user stopped it.
5. Resuming is just `orc run` again. To undo a task use `orc rewind --list` and `orc rewind <workstream>/<task>`.
