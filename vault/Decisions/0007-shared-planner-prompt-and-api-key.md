---
date: 2026-10-21
status: accepted
tags: [decision, planner, auth, roadmap]
---
# 0007: One shared planner prompt; `ANTHROPIC_API_KEY` required

## Context
M7 (the kit) says the planner and summary "live as prompts, not code". M2 says `orc plan` is tested with FakeAgentAdapter. The SDK docs bar third-party products from offering claude.ai login.

## Decision
1. **One planner prompt file, two entry points.** The planner prompt is a single file that ships with orc (a kit file). `orc plan` (M2) runs it through `AgentAdapter`, which makes it testable with `FakeAgentAdapter`. M7's `/orc-plan` skill reuses the same file. The summary prompt works the same way for `orc summarize` (M5) and `/orc-summarize` (M7).
2. **`AgentAdapter` and `FakeAgentAdapter` move into M2.** M3 keeps the Claude Agent SDK adapter and the git worktree/checkpoint manager.
3. **M7 stays scoped as written.**
4. **Auth:** orc requires `ANTHROPIC_API_KEY`. `orc check-setup` verifies it's set. It checks presence only and makes no network call, since everything outside the planner and drivers is deterministic.

## Consequences
- The prompt file has to be readable by both the CLI (packaged in `dist`/`files`) and the kit. Its location gets decided in M2.
- check-setup lists `ANTHROPIC_API_KEY` alongside the target app's env vars.
