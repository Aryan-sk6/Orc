---
date: 2026-10-22
status: accepted
tags: [decision, sdk, agents, m3]
---
# 0009: Claude Agent SDK adapter: dependency, access mapping, cost and outcomes

## Context
M3 implements `AgentAdapter` with the Claude Agent SDK, orc's first runtime dependency. The mappings had to be checked against the installed types, not guessed ([[rules]]). [[claude-agent-sdk]] was read against 0.3.306. The installed version is **0.3.308** (bundles Claude Code v2.1.308), and every type name orc uses is exported from the package root.

## Decision
1. **Dependency:** `@anthropic-ai/claude-agent-sdk` is pinned exactly at `0.3.308`. npm also installs its required peers (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`) and one platform binary of about 260 MB. Only `src/agents/claude-sdk.ts` imports it, and its test uses `import type` only. `createAdapter` loads it with a dynamic `import()`, so commands that never call an agent (`status`, `log`, `config`) don't pay for it.
2. **One turn = one `query()` in single-message mode.** Follow-up turns pass `resume: sessionId`. A streaming-input `Query` per session can come later in M4 if needed.
3. **Options on every turn:**
   - `settingSources: ["project"]`: loads the project's settings and CLAUDE.md, but not `~/.claude`, so runs are reproducible.
   - `permissionPrompts: "none"`: nobody is there to approve, so anything not pre-approved is denied and listed in `permission_denials`.
   - `systemPrompt`: the `claude_code` preset, with `append` when the request has a system prompt.
   - `env`: the injected env plus `CLAUDE_AGENT_SDK_CLIENT_APP=orc` (the SDK *replaces* the subprocess env).
   - `projectConfigRoot` is set when `projectRoot` differs from `cwd`, which is the worktree case.
4. **Access mapping:**
   - `read-only` → `tools: ["Read","Glob","Grep"]` (limits which tools exist at all), the same `allowedTools`, and `permissionMode: "dontAsk"`.
   - `edit` → `permissionMode: "acceptEdits"` plus one `Bash(<command> *)` allow rule per `allowedCommands` entry. The official permissions page confirms that a trailing ` *` also matches the bare command and that compound commands must match each part separately.
5. **Cost:** `total_cost_usd` is cumulative per session, and a resumed session starts from the total saved in its transcript. The adapter keeps the last total per session in memory, and per-turn cost = total − previous total. A zeroed result that isn't `success` (a crash) costs 0 and keeps the previous total. A total *lower* than the previous one means the transcript carried no total, so the whole figure counts. Results are rounded to 6 decimals.
6. **Outcomes:**
   - `success` → `success`.
   - `success` with `stop_reason: "refusal"`, or after a `model_refusal_no_fallback` system message → `refused`.
   - `success` with `is_error` → `error`, with the result text as the error.
   - `error_max_turns` → `max_turns` and `error_max_budget_usd` → `max_budget`. Any other subtype → `error`, with `errors[]` copied.
   - Assistant `error` codes such as `authentication_failed` are appended to the errors. `permission_denials` become `deniedActions` (for example `Bash: rm -rf dist`).
   - If the SDK throws after yielding a result, the result wins. A throw with no result rejects with `AGENT_FAILED` and the last 20 stderr lines. An abort, from the caller or from `close()`, resolves as `error` with `["aborted"]`.
   - `maxBudgetUsd <= 0` returns `max_budget` without starting a query, because the SDK rejects 0.
7. **Auth:** with `adapter: "claude-agent-sdk"`, `createAdapter` throws `MISSING_API_KEY` before any call if `ANTHROPIC_API_KEY` isn't set ([[0007-shared-planner-prompt-and-api-key]]).
8. **SDK output is read as `unknown`** and narrowed, as agents.md requires at boundaries. A type-level test (`expectTypeOf`) pins each field the adapter reads to the installed `sdk.d.ts`, so an SDK upgrade that renames one fails `npm run typecheck`.

## Alternatives considered
- **`permissionMode: "plan"` for read-only.** It's documented only as "planning mode, no execution of tools", with a plan-mode workflow wrapped around it. `dontAsk` with an explicit `tools` list gives a precise, documented surface.
- **`bypassPermissions` for edit.** It's only suitable inside containers, and allow rules don't constrain it.
- **Typing messages directly as `SDKMessage`.** This is simpler, but tests would need full SDK objects or `as` casts. The type-level pins keep most of the safety.

## Consequences
- **Known limit:** cost deltas live in memory. If orc restarts and resumes a session, its first turn counts the session's whole saved total. That overcounts, which is the safe direction for a cap. M4 can persist the last total per session in the session note if this matters.
- A check command containing `*` would act as a wildcard in its allow rule. Check commands are plain npm scripts, so this is accepted.
- An SDK upgrade means re-reading [[claude-agent-sdk]], bumping the pin, and running typecheck.
