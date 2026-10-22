---
date: 2026-10-22
tags: [session, m3]
---
# 2026-10-22: M3 Claude Agent SDK adapter and git worktree/checkpoint manager

## Goal
Complete M3 from [[Roadmap]]: a Claude Agent SDK adapter that implements `AgentAdapter`, plus the git worktree/checkpoint manager.

## Done
- **Installed `@anthropic-ai/claude-agent-sdk` 0.3.308**, pinned exactly; the docs had been read against 0.3.306. I checked every type orc uses against the installed `sdk.d.ts`, and all are exported from the package root. The `.d.ts` also documents `tools` and `permissionPrompts: "none"`. I confirmed the Bash allow-rule syntax on the official permissions page. All of this is recorded in [[claude-agent-sdk]].
- **`src/agents/claude-sdk.ts`** (`ClaudeSdkAdapter`), the only SDK import. See [[0009-claude-sdk-adapter-mapping]] for details.
  - **Access:** `read-only` gets Read/Glob/Grep in `dontAsk` mode. `edit` gets `acceptEdits` plus one `Bash(<cmd> *)` rule per allowed command.
  - **Every turn:** project settings only, no permission prompts, and the `claude_code` preset with the request's system prompt appended. `projectConfigRoot` is set for worktrees.
  - **Cost:** cumulative `total_cost_usd` becomes a per-turn delta per session. A zeroed crash result keeps the previous total.
  - **Results:** each result maps to an `AgentOutcome`. Permission denials come back as `deniedActions`.
  - **Failures:** if the SDK throws after a result, the result wins. A throw with no result gives `AGENT_FAILED` with the stderr tail. An abort, or `close()`, gives `error/aborted`.
- **The `AgentAdapter` interface grew:** requests have `allowedCommands` and `projectRoot`, and results have `deniedActions`. The fake and the fake-script loader support `deniedActions`.
- **`createAdapter(loaded, env)`** imports the SDK lazily, so `orc status` stays fast (about 75 ms), and throws `MISSING_API_KEY` before any call. `ADAPTER_UNAVAILABLE` is gone.
- **`src/git/`:** `git.ts` (execFile, no prompts), `worktrees.ts` and `checkpoints.ts`. See [[0010-worktrees-branches-checkpoint-tags]].
  - **Worktrees:** `ensureWorktree` creates branch `orc/<ws>` in `<repo>-orc-worktrees/<ws>`. It is idempotent and refuses conflicts.
  - **Checkpoints:** `createCheckpoint` commits pending work, then makes the tag `orc-cp/<ws>/<task>`, or `.2`, `.3` and so on at a new commit.
  - **Rewind:** `rewindToCheckpoint` first makes an `orc-backup/<ws>/<n>` tag, then resets and cleans. Ignored files are kept.
- **`npm run smoke:sdk`** is an opt-in live check: three cheap turns (read-only, resume, edit), $0.25 cap per turn. It is not part of the tests, and I **did not run it** because there is no `ANTHROPIC_API_KEY` in this environment.
- **Tests:** 196 pass, up from 157. Adapter tests replay scripted SDK messages, and `expectTypeOf` pins the fields read to the installed `.d.ts`. Git tests use real temp repos with an isolated git config. Typecheck, lint and build are clean.

## Commits
- `feat(agents)`: Claude Agent SDK adapter behind AgentAdapter
- `feat(git)`: worktree and checkpoint manager
- `docs(vault)` / `chore`: smoke script, M3 session, roadmap

## Problems hit
- The SDK pulls in its required peers (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`) and a ~260 MB platform binary. That's accepted; it's what "Claude Code under the hood" costs.
- `total_cost_usd` on resume carries the transcript's saved total, but only "when it has one". The rule in 0009 covers both cases, but cost tracking resets when orc restarts (a known limit; it overcounts).
- On a missing identity, git prints "tell me who you are" on later stderr lines, which `GIT_FAILED` keeps in `details` rather than the message. The identity check matches against both.

## Decisions
- [[0009-claude-sdk-adapter-mapping]]
- [[0010-worktrees-branches-checkpoint-tags]]

## Next steps
- [ ] **M4:** the driver loop. For each workstream: `ensureWorktree` → `createCheckpoint` before each task → `runTurn` (edit access, `allowedCommands` = the check commands, `projectRoot` = the main checkout, `resumeSessionId`) → run checks → next task with no model call, or a fix prompt or escalation from the driver model. Apply the USD run cap and the retry cap, and pause with an entry in `decisions.md`.
- [ ] Run `npm run smoke:sdk` (user, with a key), then `orc plan` on a real idea with the SDK adapter. Neither the reply protocol nor the live adapter has been tried yet.
