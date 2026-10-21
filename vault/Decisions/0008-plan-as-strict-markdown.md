---
date: 2026-10-22
status: accepted
tags: [decision, planner, vault, m2]
---
# 0008: The plan is strict markdown; the planner returns files, orc writes them

## Context
`orc plan` must write the plan into the target vault. Later milestones act on parts of it: `check-setup` needs the env vars and docs, and M4's drivers need tasks, dependencies and owned files. The vault has to stay plain markdown that works in Obsidian, and [[0005-session-state-in-note-frontmatter]] already rejected a hidden JSON copy as a second source of truth. [[0007-shared-planner-prompt-and-api-key]] requires one planner prompt file shared with M7's `/orc-plan`.

## Decision
1. **Markdown is the only source of truth.** There's no `plan.json`. The parts orc acts on follow strict formats that `src/vault/plan.ts` parses:
   - `plan/setup.md`, under `## Env vars`: `` - `NAME`: purpose ``, with `(optional)` allowed. `- None` means an empty list.
   - `plan/docs-needed.md`, under `## Docs`: `` - `file.md`: what to paste (URL) ``.
   - `plan/workstreams/<name>.md`: `## Goal`, `## Owns`, `## Tasks` and `## Definition of done`. Tasks are written `- [ ] T1: title (needs: other-ws/T2)`. Tasks in a workstream run in order, and `needs:` adds cross-workstream edges. The workstream name must be a valid session name, since it becomes a branch.
   - Validation reports every issue: missing files, unknown `needs`, cycles (including the implicit in-order edges), and a path owned by two workstreams. It needs at least one workstream and one contract.
   - orc generates `plan/task-graph.md` (a table plus a mermaid chart) and `plan/questions.md` (the answers). The planner may not write either one.
2. **The planner returns files and orc writes them.** The planner runs **read-only** and replies with `<<<orc-file path="…">>>` … `<<<orc-end>>>` blocks. orc checks paths (only `plan/` or `contracts/`, no `..`), validates the whole plan, and writes atomically only once everything passes. An invalid reply gets up to `retries.maxPerTask` repair turns in the same session.
3. **Prompt split.** `kit/prompts/planner.md` says *what* to produce, and it ships in the npm package (`files: ["dist", "kit"]`). The reply protocol (questions JSON and file blocks) lives in `src/planner/protocol.ts` and is CLI-only. That way M7's `/orc-plan` can reuse the prompt file and have the agent write the files with its own tools.
4. **Two turns, one session.** Turn 1 asks for 10 to 15 questions, each with a reversible default (Enter accepts it, `--defaults` accepts them all). orc asks them in the terminal and saves `plan/questions.md` *before* turn 2, so the answers survive a failed run. Turn 2 resumes the same session to write the plan. A count outside 10 to 15 only warns.
5. **The fake adapter is configured, not hidden.** A new config key `fakeScript` (default `orc.fake.json`, relative to the config file) feeds `adapter: "fake"`. Long replies can use `textFile`.

## Alternatives considered
- **The model emits a JSON plan, and orc renders the markdown.** It's easier to validate, but it creates two sources of truth, and edits made in Obsidian would be lost.
- **The planner writes the files with its own tools.** That needs edit permissions and gives no validation before files land. It's also untestable without simulating writes in the fake.
- **Workstream-level `dependsOn` in frontmatter.** It's coarser and would serialize whole workstreams. Task-level `needs` lets M4 start everything that's unblocked. Workstream dependencies are derived from it.

## Consequences
- M4 can rely on `parsePlan()` with no model call to work out the next task.
- Changing a format means updating the parser, `kit/prompts/planner.md` and the fixture `test/fixtures/planner/plan-reply.md` together.
- Hand edits in Obsidian must keep these formats. A later `orc plan --check` (or M4 at startup) can re-validate them.
- `--force` removes old `plan/workstreams/`, but leaves contracts that the new plan doesn't mention.
