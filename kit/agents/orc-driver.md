---
name: orc-driver
description: Decides what to do after a coding session's check failed or it hit a problem: a short fix instruction or an escalation. Read-only. Use when steering a coding session by hand; `orc run` has its own driver.
tools: Read, Grep, Glob
model: haiku
maxTurns: 6
---

{{prompt:driver}}

When you are called, the prompt names the vault paths and the failing output. Read the workstream note, the contracts and `rules.md` yourself if you need them.
