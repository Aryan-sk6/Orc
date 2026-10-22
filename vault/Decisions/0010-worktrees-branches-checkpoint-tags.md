---
date: 2026-10-22
status: accepted
tags: [decision, git, m3]
---
# 0010: Worktrees outside the checkout, `orc/<ws>` branches, `orc-cp/` checkpoint tags

## Context
`orc run` (M4) needs one git worktree and branch per workstream, and `orc rewind` (M5) needs a checkpoint before each task ([[Spec]]). Workstream names come from `plan/workstreams/<name>.md` and are already valid session names (lowercase kebab-case, [[0008-plan-as-strict-markdown]]). The code is in `src/git/` and shells out to the `git` CLI with `execFile` (no shell, no new dependency).

## Decision
1. **Worktrees live outside the main checkout.** The default is `<repo>-orc-worktrees/<workstream>` next to the repo (`defaultWorktreesDir`). A folder inside the checkout is rejected. A nested copy would be picked up by the app's own `tsc`, test runner and linters, and Claude Code would load the parent's `CLAUDE.md` as well. M4 decides whether this becomes a config key.
2. **Branch `orc/<workstream>`**, created from the main checkout's `HEAD` (or a given base). `ensureWorktree` is idempotent:
   - It reuses a matching worktree, re-attaches an existing branch, and prunes and recreates a folder deleted by hand.
   - It refuses conflicts (`WORKTREE_CONFLICT`): a non-worktree folder at the path, the branch checked out elsewhere, or a worktree on the wrong branch.
   - orc never deletes branches. `removeWorktree` removes only the folder and refuses if there is uncommitted work.
3. **Checkpoints are lightweight tags `orc-cp/<workstream>/<task>`**, made by `createCheckpoint` before each task. Pending work is committed first. Tags are shared by every worktree, so a rewind works from anywhere.
   - Checkpointing the same task again at the same commit returns the existing checkpoint.
   - At a different commit (a retry, or after a rewind) it creates `<task>.2`, `<task>.3`, and so on. Old checkpoints never move.
   - The user-facing id is `api/T3` or `api/T3.2`.
4. **orc's bookkeeping commits use `--no-verify`.** These are work-in-progress snapshots on orc's own branches, and orc runs the real checks itself (M4) and at integration (M5). Commit messages read `orc(<ws>): save work before <task>`. A missing git identity gets a clear "run git config user.name/user.email" error. orc never invents an identity.
5. **Rewind** (`rewindToCheckpoint`, the primitive for M5's command):
   - It only acts on a worktree that is on `orc/<workstream>`.
   - It commits current work and tags it `orc-backup/<ws>/<n>`, so a rewind can be undone.
   - It then runs `reset --hard` to the checkpoint and `clean -d --force`. Ignored files such as `node_modules` are kept.
6. Git runs with `GIT_TERMINAL_PROMPT=0` and `GIT_EDITOR=true` so it can never block on input. It needs git ≥ 2.31 (`rev-parse --path-format=absolute`). Bare repos and custom git dirs are rejected with `NOT_A_GIT_REPO`.

## Alternatives considered
- **Worktrees in `.orc/worktrees/` inside the repo, excluded through `.git/info/exclude`.** Self-contained, but app tooling and the parent `CLAUDE.md` leak into them.
- **Annotated tags** would carry a message and date, but they need a git identity even when nothing is committed. Lightweight tags plus the LOG line are enough.
- **Moving a tag on a retry.** Simpler names, but it loses the earlier checkpoint.
- **A git library** (isomorphic-git, simple-git): an extra dependency for something a few `execFile` calls cover.

## Consequences
- Tests run real git in temp repos with an isolated config (`test/helpers/git.ts`). There's no network, and the developer's global git config, signing and hooks don't leak in.
- **Open for M4/M5:** each worktree has its own copy of the committed `vault/`. orc must write LOG and session notes to the **main** checkout's vault, and the integration merge must not conflict on vault files. See [[Open Questions]].
