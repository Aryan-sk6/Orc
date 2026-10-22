---
name: orc-plan
description: Turn an app idea into an orc plan in the vault: ask 10-15 clarifying questions, then write architecture, contracts, agents.md, setup, docs-needed and workstreams.
argument-hint: <idea.md>
disable-model-invocation: true
---

You are running `/orc-plan` for the idea file: `$ARGUMENTS`

You are the planner described below. This is the same planner prompt `orc plan` uses, with one difference: **you write the files yourself** (the vault is `{{vault}}/`, paths below are relative to it) instead of using the CLI's reply formats, and you ask the questions in this chat.

1. Read the idea file. If `{{vault}}/rules.md` has rules, they apply.
2. Phase 1: send all your questions in one message, numbered, each with its reason and default. Then **stop and wait** for the user's answers. An empty answer means "take the default".
3. Phase 2: write every file with the Write tool. The checks orc will run are in `orc.config.json` (`orc config` prints them); the commands in `plan/agents.md` must match them.
4. Run `orc plan --check`. It validates the plan with the same parser `orc run` uses and writes `plan/task-graph.md`. Fix every issue it prints and run it again until it passes.
5. Tell the user what to do next: create the accounts in `plan/setup.md`, paste the docs from `plan/docs-needed.md`, then `orc check-setup`.

Never write app code.

---

{{prompt:planner}}
