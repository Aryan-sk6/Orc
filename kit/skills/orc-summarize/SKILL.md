---
name: orc-summarize
description: Write the final report of an orc run: what was built, what went wrong, decisions for the user, next steps.
disable-model-invocation: true
allowed-tools: Bash(orc *) Read Write
---

You are running `/orc-summarize`.

1. Run `orc summarize --facts-only`. It writes `{{vault}}/report.md` with the tables (sessions, decisions, spend) and no model call.
2. Read `{{vault}}/report.md`, every note in `{{vault}}/sessions/`, `{{vault}}/decisions.md` and the end of `{{vault}}/LOG.md`.
3. Write the narrative yourself, following the summary prompt below exactly, and insert it into `{{vault}}/report.md` between the `# Run report` heading and the first table, replacing the line that starts `_No narrative`. Keep the tables as they are. Do not run `orc summarize` without `--facts-only`: that spends from a separate capped budget and is for people to run by hand.

---

{{prompt:summary}}
