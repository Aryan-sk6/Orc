---
date: 2026-10-21
status: accepted
tags: [decision]
---
# 0001: Obsidian vault as shared session memory

## Context
Work on ORC happens across many sessions, both human and Claude. Context gets lost between them.

## Decision
Keep an Obsidian vault at `vault/` and commit it to git. Each session reads [[Home]] at the start and writes a session log at the end. Decisions go in `Decisions/`, and lasting knowledge goes in `Context/`.

## Alternatives considered
- Claude's private per-user memory: other people and tools can't see it.
- A single `NOTES.md`: it doesn't scale and has no links or graph.

## Consequences
- Memory is versioned, reviewable and shared through the repo.
- Sessions have to update notes as they go, or the vault goes stale.
