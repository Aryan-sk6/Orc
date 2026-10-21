---
date: 2026-10-21
status: accepted
tags: [decision, vault]
---
# 0005: Session state lives in session-note frontmatter

## Context
`orc status` needs, for each session, the status, current task, check results and tokens spent. The spec says drivers communicate **only through the vault**, and the vault has to stay plain markdown that works in Obsidian.

## Decision
- Each `sessions/<name>.md` carries its machine state as **flat frontmatter**: `session, workstream, branch, status, currentTask, tasksDone, tasksTotal, checks, tokensSpent, updated`. The body holds the human-readable `## Progress / ## Problems / ## Decisions` sections.
- `checks` is one scalar, `"typecheck:pass,lint:fail,…"`, so the frontmatter stays flat and orc needs no YAML library. Our own parser handles `key: scalar` only.
- `orc status` reads **only** the vault. There's no hidden state file or cache.
- Updates rewrite the frontmatter and keep the body plus any extra keys a human added in Obsidian, such as `aliases` or `tags`.
- Session names are lowercase kebab-case (max 63 characters) because they become file and branch names.
- `decisions.md` uses numbered blocks, `## D-NNN [open|resolved] time · session`. A human resolves one by editing `[open]` to `[resolved]`.
- Concurrency: `LOG.md` is written with a single `appendFile` per line, which is atomic on POSIX. Read-modify-write on notes and decisions goes through an in-process `KeyedMutex`. **Assumption:** one orc process owns a vault during a run.

## Alternatives considered
- A `state.json` beside the vault: simpler to parse, but it's hidden from Obsidian and gives a second source of truth.
- A YAML dependency: the frontmatter is flat on purpose, so it isn't needed.

## Consequences
- Obsidian's Properties view and Dataview can show session status for free.
- Parsing hand-edited notes has to be lenient. Invalid notes appear on stderr in `orc status`, never as a crash.
- If several orc processes ever share one vault, the decision-ID allocation needs a file lock.
