# ORC

**Read `agents.md` first.** It covers the stack, folders, hard rules, patterns and commands. Scope is defined in `vault/Context/Spec.md`, and the current milestone is in `vault/Context/Roadmap.md`. Build one milestone per session, then commit, stop and report.

## Shared session memory: `vault/`

`vault/` is an Obsidian vault and serves as the project's shared memory. It is committed to git.

**At the start of a session:** read `vault/Home.md`, `vault/rules.md` and `vault/Context/Roadmap.md`. Check `vault/Context/Open Questions.md`, the latest note in `vault/Sessions/`, and the tail of `vault/LOG.md`.

**While working:**
- Append one line per completed step to `vault/LOG.md`: `[YYYY-MM-DD HH:mm][session] did X | touching: files`.
- Record each meaningful decision in `vault/Decisions/NNNN-kebab-title.md` (template: `vault/Templates/Decision.md`) and link it from `Home.md`.
- Put lasting knowledge (architecture, conventions, gotchas) in `vault/Context/`.
- If an SDK API isn't covered by `vault/docs/`, stop and ask the user to paste the docs.

**At the end of a session:** write `vault/Sessions/YYYY-MM-DD-topic.md` (template: `vault/Templates/Session.md`). Then update `Home.md` ("Current state", "Recent sessions") and `Context/Roadmap.md`.

**Conventions:** link with `[[wikilinks]]`, use absolute dates, add frontmatter `tags`, and keep notes short. Edit existing notes in place rather than creating duplicates.
