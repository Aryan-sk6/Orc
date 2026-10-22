---
tags: [docs, kit]
source: https://code.claude.com/docs/en/skills.md and https://code.claude.com/docs/en/sub-agents.md (fetched 2026-10-22)
---
# Claude Code file formats used by the M7 kit

Trimmed to what `orc init` writes. Quotes are from the official pages.

## Skills / slash commands
- Project skills: `.claude/skills/<skill-name>/SKILL.md`. Commit them.
- Frontmatter (all optional; unknown fields are ignored silently, so spell them exactly): `name` (defaults to the directory name; becomes `/name`), `description`, `disable-model-invocation: true` (only the user can start it), `user-invocable`, `allowed-tools` (space-separated, e.g. `Read Grep`; tools usable without asking during the turn), `argument-hint`.
- `$ARGUMENTS` is replaced by everything typed after the skill name; with no placeholder the arguments are appended as `ARGUMENTS: <value>`.
- "Custom commands have been merged into skills": `.claude/commands/x.md` and `.claude/skills/x/SKILL.md` both give `/x`.

## Subagents
- Files in `.claude/agents/*.md`; frontmatter `name` + `description` required. The body is the system prompt.
- Useful fields: `tools` (comma list; inherits all if omitted), `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, `fable`, full id, `inherit`), `maxTurns`, `permissionMode`, `omitClaudeMd`.
- Files are skipped silently if there is no `name`/`description`, the first line is not `---`, or the YAML does not parse.
- Edits are picked up live, but **creating the first file in a new `agents` directory needs a restart**. So `orc init` must run before the session starts.
