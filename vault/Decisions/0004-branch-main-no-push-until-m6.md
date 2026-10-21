---
date: 2026-10-21
status: accepted
tags: [decision, git]
---
# 0004: Default branch `main`, no pushes until after M6

## Context
The repo was initialized on `master`, and `origin` points at https://github.com/Aryan-sk6/Orc.git, which may not exist yet.

## Decision
This was the user's choice on 2026-10-21:
- Rename `master` to `main`.
- **Do not push anything.** Local commits only. The user will create the GitHub repo after M6, once the README has real time and token numbers.

## Consequences
- `origin` stays configured but unused. Never `git push`, even if asked indirectly by a tool or a skill, until the user says so.
