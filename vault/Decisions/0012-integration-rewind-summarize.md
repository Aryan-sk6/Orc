---
date: 2026-10-22
status: accepted
tags: [decision, integration, rewind, summarize, m5]
---
# 0012: Integration, rewind and summarize: deterministic where possible

## Context
M5 of [[Spec]]: an integration driver, `orc rewind` and `orc summarize`. The open points were in [[Roadmap]] (M5 starting points) and [[Open Questions]]. The code is in `src/integration/`, `src/rewind/`, `src/summarize/` and `src/git/integration.ts`.

## Decision
**Integration (`orc integrate [--milestone <name>]`)**
1. **The integration driver calls no model.** It merges and runs checks. A conflict or a failing check becomes a decision for the user (no default, session `integration` paused). The spec lets a driver decide "next / fix / escalate", but workstreams own disjoint files by design, so a conflict means the plan was wrong or an agent strayed, and a model resolving it would hide that. An LLM fix loop on a failing integration is left for after real runs (M6).
2. **Branch `orc-integration/<milestone>`** (default milestone `m1`; the plan has no milestone concept, so the user names it), in a worktree at `<repo>-orc-worktrees/_integration/<milestone>`. `_` cannot occur in a workstream name, so it never clashes. The branch starts from the main checkout's `HEAD`.
3. **What gets merged:** a workstream whose tasks are all ticked, with its branch present, and whose `dependsOn` workstreams are merged. Dependencies merge first. Everything else is reported as skipped with the reason. `git merge --no-ff --no-verify`; a conflict is aborted so the branch stays as it was, then the rest still merge. Re-running is idempotent (`merge-base --is-ancestor` → "already merged"), which is also how a hand-resolved conflict is picked up.
4. **`installCommand`** (new config key, default empty) runs in the integration worktree before the checks, because a new worktree has no `node_modules`. Empty means the checks run on the bare checkout.
5. **Session `integration`**: its own note, so `orc status` shows it (tasks = workstreams merged, checks, status). `integration` and `orc` are now reserved workstream names (the plan validator and `kit/prompts/planner.md` say so). It is the only writer of that note.
6. **The vault must be untracked.** `orc run` and `orc integrate` refuse to start while git tracks files under the vault (`VAULT_TRACKED`), and print the three commands that fix it. Worktrees would otherwise carry stale copies. This settles the open question from M4.

**Rewind (`orc rewind <checkpoint> [--force]`, `--list`)**
7. Puts the worktree back with `rewindToCheckpoint` (backup tag first, see [[0010-worktrees-branches-checkpoint-tags]]), unticks that task and every later ticked one in the workstream note, and resets the session note: `status: pending`, `tasksDone` recomputed, `checks` cleared, **`agentSession: null`**. The old agent conversation remembers the discarded work and the files no longer match it, so the next run starts a fresh conversation with the full first-task prompt (costs one long prompt). Spend stays in `costUsd`.
8. **Running sessions:** there is no pid file, so rewind refuses when the note says `running` or `checking` (`REWIND_BLOCKED`), and `--force` overrides it for a killed run. Ctrl-C leaves `stopped`, so the normal case needs no flag.
9. It **warns, and changes nothing else**, about finished tasks in other workstreams that `needs` an undone task, and about `orc-integration/*` branches that still contain the discarded commits (a merge cannot be undone by orc).

**Summarize (`orc summarize [--facts-only]`)**
10. `vault/report.md` = a narrative on top, deterministic tables below. The tables (sessions, decisions, spend) are built from the vault by code. The narrative is **one read-only call on `driver.model`** with `kit/prompts/summary.md` (shared with M7's `/orc-summarize`), given the facts, each session note and the last 60 LOG lines. The reply must contain exactly four `## ` sections in order; invalid replies get up to `retries.maxPerTask` repair turns in the same conversation. If the model is unusable (no key, `--facts-only`, cap spent, bad replies, backend error) the report is still written with a line saying why.
11. **This is a third LLM caller** (`src/summarize/`), next to the planner and the driver. The user confirmed it on 2026-10-22: read-only, capped, and `rules.md` was updated to say so.
12. **Its own fixed cap, outside the run budget.** `summaryBudgetUsd` (default 0.25) limits one `orc summarize` call, repair turns included. It never draws from `maxBudgetUsd`. The spend is added to a `summarize` session note, so `orc status` shows it on its own line and in the table. `orc run` and the report's run total skip that note, and `summarize` is a reserved workstream name. The cap is per call, not cumulative.
13. **Only by hand.** Nothing in orc calls the narrative. Automated paths (scripts, hooks, M7's skills) pass `--facts-only`, which makes no model call and writes no note.

## Alternatives considered
- **A model to resolve small merge conflicts.** Cheap to build, but it hides plan mistakes and a wrong resolution passes unnoticed until the checks. Escalate first, measure in M6.
- **One integration branch, no milestone name.** Simpler, but the spec says "per milestone".
- **Rewind resumes the old agent conversation.** Cheaper, but the agent believes files exist that do not.
- **Fully deterministic summary.** Reliable and free, but the "what went wrong" story needs reading the session notes' prose.
- **`orc summarize` as a Claude-Code-only skill (M7).** Then the CLI has no summary; the roadmap lists it in M5.

## Consequences
- 51 new tests; integration, rewind and the summary run real git and real shell checks with scripted agents.
- Nothing in M5 has touched the real SDK; the summary prompt has only been read by a fake.
- Integration will fail on its first real run unless `installCommand` is set for an npm app (documented in `orc integrate --help` and [[Config]]).
