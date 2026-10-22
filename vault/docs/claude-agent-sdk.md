---
tags: [docs, sdk]
package: "@anthropic-ai/claude-agent-sdk"
read_against: "0.3.306 (npm latest on 2026-10-21; bundles Claude Code v2.1.306). Installed and re-verified: 0.3.308 (2026-10-22)"
fetched: 2026-10-21
sources:
  - https://code.claude.com/docs/en/agent-sdk/overview.md
  - https://code.claude.com/docs/en/agent-sdk/typescript.md
  - https://code.claude.com/docs/en/agent-sdk/configuration.md
  - https://code.claude.com/docs/en/agent-sdk/agent-loop.md
  - https://code.claude.com/docs/en/agent-sdk/sessions.md
  - https://code.claude.com/docs/en/agent-sdk/permissions.md
  - https://code.claude.com/docs/en/agent-sdk/subagents.md
  - https://code.claude.com/docs/en/agent-sdk/cost-tracking.md
---
# Claude Agent SDK (TypeScript): what orc needs

This is a trimmed copy of the official docs. The signatures are **copied, not paraphrased**. When something isn't covered here, re-fetch the source page; don't guess. Before writing M3 code, check type names against the installed `.d.ts`.

## Package and install
- `npm install @anthropic-ai/claude-agent-sdk`. It bundles a native Claude Code binary as an optional dependency, and the SDK version tracks it: SDK `0.3.N` bundles Claude Code `v2.1.N`.
- If optional dependencies were skipped, it throws `Native CLI binary for <platform>-<arch> not found`. The fix is `pathToClaudeCodeExecutable`.
- **Auth:** use an API key (`ANTHROPIC_API_KEY`). From the overview: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."*

## `query()`
```ts
function query({ prompt, options }: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;   // Query extends AsyncGenerator<SDKMessage, void>
```
- **Single-message mode** (`prompt: string`): one task runs to a `result` message. On an error result the SDK yields the result **and then throws**, so wrap the `for await` in `try`. The session ID is already captured from the result by then.
- **Streaming-input mode** (`prompt: AsyncIterable<SDKUserMessage>`): one process stays alive and handles many user turns. **Each turn emits its own `result`.** Only in this mode can you call `interrupt()`, `setModel()`, `setPermissionMode()` and `applyFlagSettings()`. It fits orc's event-driven driver well: yield the next `SDKUserMessage` only after the previous turn's `result` arrives.
  ```ts
  { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }
  ```

### `Query` methods orc may use
- `interrupt(): Promise<SDKControlInterruptResponse | undefined>`. Streaming mode only.
- `close(): void` terminates the underlying process. Use it for `orc stop`.
- `setModel(model?)`, `setPermissionMode(mode)`. Streaming mode only.
- `streamInput(stream: AsyncIterable<SDKUserMessage>)`.
- There's also `abortController` in Options. The only typed error is `class AbortError extends Error {}`. Other failures (the process exits or fails to launch) reject the iteration with untyped errors.

## Options orc needs
| Option | Type | Notes |
|---|---|---|
| `cwd` | `string` | Defaults to `process.cwd()`. **There's no setter**, so a new directory needs a new session. Project settings, hooks, skills and session storage all key off `cwd`. |
| `projectConfigRoot` | `string` | **Matters for worktrees.** It's the absolute path of the trusted checkout that `cwd` is a worktree of. Project settings, `.mcp.json` and `.claude/` (agents, skills, commands) are read from here, while `CLAUDE.md` and `.claude/rules/` still load from `cwd`. Needs Claude Code v2.1.275+. |
| `additionalDirectories` | `string[]` | Grants file access outside `cwd`, for example the vault if it lives outside the worktree. |
| `model` | `string` | Accepts an alias or a full ID such as `"claude-haiku-5-5"`. |
| `fallbackModel` | `string` | Comma-separated chain. Throws at startup if it equals `model`. |
| `effort` | `'low'\|'medium'\|'high'\|'xhigh'\|'max'` | Lower effort means fewer tokens. |
| `permissionMode` | `PermissionMode` | See below. |
| `allowedTools` | `string[]` | **Pre-approves** the listed tools but doesn't restrict to them. Scoped forms like `"Bash(npm test *)"` work. |
| `disallowedTools` | `string[]` | A bare name (`"Bash"`) removes the tool entirely. A scoped form (`"Bash(rm *)"`) denies matching calls in **every** mode, including bypass. |
| `allowDangerouslySkipPermissions` | `boolean` | Required for `bypassPermissions`. |
| `systemPrompt` | `string \| { type:'preset'; preset:'claude_code'; append?: string } \| …` | Leaving it unset gives a *minimal* prompt. Use the preset plus `append` to keep Claude Code behaviour. |
| `settingSources` | `("user"\|"project"\|"local")[]` | When unset, all three load. **Include `"project"`** or `CLAUDE.md`/`AGENTS.md`-style project instructions won't load. `[]` disables filesystem settings. |
| `resume` | `string` | Session ID to resume. |
| `continue` | `boolean` | Resume the most recent session in `cwd`. |
| `forkSession` | `boolean` | When used with `resume`, branches into a new session ID. |
| `sessionId` | `string` | Supply your own UUID instead of an auto-generated one, which lets orc know the ID up front. |
| `persistSession` | `boolean` | Default `true`. If `false`, the session can't be resumed. |
| `maxTurns` | `number` | Caps tool-use round trips. Hitting it gives `error_max_turns`. `0` means unlimited. |
| `maxBudgetUsd` | `number` | **USD**, based on a client-side estimate. Hitting it gives `error_max_budget_usd`. Spend can overshoot by one response, so leave headroom. `0` is rejected. Only the call's own spend counts, not restored totals. |
| `env` | `Record<string,string\|undefined>` | **Replaces** the subprocess environment, so spread `process.env` into it. |
| `agents` | `Record<string, AgentDefinition>` | Programmatic subagents. These override `.claude/agents/*.md` files with the same name. |
| `stderr` | `(data: string) => void` | Captures stderr. |
| `taskBudget` | `{ total: number }` | *Alpha.* An **advisory** token budget the model is told about. It isn't enforced. |
| `abortController` | `AbortController` | Cancellation. |

## Running headless in a directory
```ts
for await (const m of query({
  prompt: "…",
  options: { cwd: worktreePath, projectConfigRoot: repoRoot, model, permissionMode: "acceptEdits",
             allowedTools: ["Bash(npm run *)", "Bash(npx tsc *)"], settingSources: ["project"] },
})) { /* … */ }
```

## Sessions: resume with a new prompt
- Get the session ID from `result.session_id`, which is on **every** result, success or error. It's also on the init system message (`type:"system", subtype:"init"`, field `session_id`). Alternatively set `sessionId` yourself.
- **Resume:** `query({ prompt: "next task …", options: { resume: id, cwd } })`. The new prompt continues with full prior context.
- Transcripts live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. `<encoded-cwd>` is the absolute `cwd` with every non-alphanumeric character replaced by `-`. Resume works only on the same machine, and the lookup searches beyond the current project directory (Claude Code v2.1.223+).
- Sessions persist the **conversation, not files.** File state is orc's git checkpoints. (`enableFileCheckpointing` with `rewindFiles()` exists but isn't needed.)
- The V2 `createSession()` API was **removed** in 0.3.142. Don't use it.

## Permission modes
`type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto"`

Evaluation order is hooks → deny rules → ask rules → **mode** → allow rules → `canUseTool`.

- `default`: since Claude Code v2.1.302, a call that needs approval, with no allow rule and no `canUseTool`, is **denied**.
- `acceptEdits`: auto-approves Edit/Write and `mkdir touch rm rmdir mv cp sed` inside `cwd` and `additionalDirectories`. Other Bash goes through allow rules. **This is the recommended mode for an unattended dev machine.**
- `dontAsk`: anything that would prompt is denied. Only allowlisted calls and calls that need no approval (such as reads in `cwd`) run. Gives a fixed tool surface.
- `bypassPermissions`: everything runs. `allowedTools` does **not** constrain it, though `disallowedTools` still blocks. It needs `allowDangerouslySkipPermissions: true` and refuses to run as root. Use only in containers.
- `plan`: read-only planning.
- `auto`: a classifier decides. Its availability depends on the model.
- Subagents inherit the parent's mode, with exceptions listed on the permissions page.

## Token usage and cost
- **`result.modelUsage`** is `{ [model: string]: ModelUsage }`. It covers the **whole tree**: main loop, subagents and compaction. Use it for accounting.
  ```ts
  type ModelUsage = { inputTokens: number; outputTokens: number; thinkingTokens?: number;
    cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearchRequests: number;
    costUSD: number; contextWindow: number; maxOutputTokens: number;
    canonicalModel?: string; provider?: string; costBasis?: 'list'|'managed'|'unknown' };
  ```
  `outputTokens` already includes `thinkingTokens`, so don't add them together.
- `result.usage` is a `NonNullableUsage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, …) and covers the **main loop only**, which undercounts when subagents run.
- `result.total_cost_usd` is a client-side **estimate** and isn't billing data.
- **Resumed sessions report cumulative totals**, including earlier spend restored from the transcript (Claude Code v2.1.277+). Take the latest result's total and **subtract the previous total** to get the per-turn delta. Don't sum results.
- In **streaming mode**, `modelUsage` and `total_cost_usd` on each result are running totals for the whole call, so again use the latest value, not a sum.
- Assistant messages carry `message.message.usage` per step. Steps from parallel tools share `message.message.id`, so deduplicate by ID. **Per-step `output_tokens` is a placeholder**, so read real output counts from the result.
- After a crash, an `error_during_execution` result may have **zeroed** totals. Fall back to the previous result.

## Result message
```ts
// success arm
{ type:"result"; subtype:"success"; session_id; duration_ms; duration_api_ms; is_error: boolean;
  num_turns; result: string; stop_reason: string|null; total_cost_usd; usage; modelUsage;
  permission_denials: SDKPermissionDenial[]; terminal_reason?: TerminalReason; … }
// error arm
{ type:"result"; subtype: "error_max_turns"|"error_during_execution"|"error_max_budget_usd"
  |"error_max_structured_output_retries"; errors: string[]; /* same accounting fields */ … }
```
- Read `result` only on `subtype === "success"`. Also check `is_error`, since success can still have `is_error: true`.
- `stop_reason === "refusal"` means the model declined.
- `terminal_reason` gives the reason, for example `"completed" | "max_turns" | "budget_exhausted" | "api_error" | "prompt_too_long" | …`.
- `permission_denials` lists tool calls that were blocked. This is useful to the driver ("your Bash call was denied").

## Other message types worth handling
- `SDKAssistantMessage`: `{ type:"assistant"; message: BetaMessage; parent_tool_use_id: string|null; error?: SDKAssistantMessageError; agent_id?; … }`. `error` is one of `'authentication_failed' | 'billing_error' | 'rate_limit' | 'overloaded' | 'invalid_request' | 'model_not_found' | 'server_error' | 'max_output_tokens' | …`.
- `SDKSystemMessage` init: `{ type:"system"; subtype:"init"; session_id; cwd; model; permissionMode; tools; claude_code_version; … }`.
- `SDKCompactBoundaryMessage` (`type:"system", subtype:"compact_boundary"`) fires when context was auto-compacted. Persistent rules belong in CLAUDE.md or agents.md, which are re-injected every request.

## Subagents (relevant to M7 drivers in `.claude/agents/`)
- Subagents are files in `.claude/agents/*.md`, or `options.agents` (`AgentDefinition`) passed programmatically. Programmatic definitions win on a name clash.
- ```ts
  type AgentDefinition = { description: string; prompt: string; tools?: string[]; disallowedTools?: string[];
    model?: string /* 'haiku' | 'sonnet' | 'opus' | 'fable' | 'inherit' | full ID */; maxTurns?: number;
    effort?: …; permissionMode?: PermissionMode; skills?: string[]; omitClaudeMd?: boolean; background?: boolean; … };
  ```
- A subagent gets **a fresh context**: only its own prompt plus the Agent tool's prompt string, and the project CLAUDE.md unless `omitClaudeMd` is set. It does **not** get the parent's history.
- By default subagents run **in the background** and their report arrives in a later turn. Ask Claude to "wait", or set `background`.
- Limits: env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3), `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20), and `maxBudgetUsd` (includes subagent spend).
- A new `.claude/agents/` **directory** created mid-session isn't picked up until restart. A new file in an existing directory is picked up within seconds.

## Gaps and judgement calls
1. ~~**No hard token cap.**~~ **Resolved:** orc does no token accounting. The run cap is `maxBudgetUsd` (USD, estimated) plus the retry cap. Per-turn cost is the delta of `total_cost_usd`. See [[0006-usd-run-cap-no-token-accounting]].
2. ~~**Auth.**~~ **Resolved:** `ANTHROPIC_API_KEY` is required, and `check-setup` verifies it. See [[0007-shared-planner-prompt-and-api-key]].
3. ~~**Exports.**~~ **Resolved (M3, 2026-10-22):** checked against the installed **0.3.308** `sdk.d.ts`. `query`, `Options`, `Query`, `SDKMessage`, `SDKResultMessage`, `SDKResultSuccess`, `SDKResultError`, `SDKSystemMessage`, `SDKAssistantMessage`, `SDKPermissionDenial`, `PermissionMode`, `ModelUsage`, `TerminalReason` and `AbortError` are all exported from the package root. See [[0009-claude-sdk-adapter-mapping]].

## Verified against the 0.3.308 `.d.ts` (2026-10-22)
These options aren't on the pages above, but their doc comments are in `sdk.d.ts`:
- `tools?: string[] | { type:'preset'; preset:'claude_code' }` sets the **base set** of built-in tools, and `[]` disables them all. *"native builds may provide search via Bash find/grep instead of the dedicated Grep/Glob tools. List Grep/Glob here or in allowedTools to get them."*
- `permissionPrompts?: 'host' | 'none'`. With `'none'`, *"anything that would otherwise prompt is denied immediately … `canUseTool` is never called."*
- `total_cost_usd` doc: *"a resumed or forked session continues from the total its transcript saved, when it has one (so the first result already carries the earlier turns; maxBudgetUsd counts only the spend since this query() call started or last /clear)"*.
- `SDKModelRefusalNoFallbackMessage` (`type:"system", subtype:"model_refusal_no_fallback"`) is the structured form of a refusal with no fallback retry.
- `SDKAssistantMessageError` also includes `'oauth_org_not_allowed' | 'account_on_hold' | 'verification_required' | 'unknown' | 'cloud_credential_error'`.

From https://code.claude.com/docs/en/permissions.md (fetched 2026-10-22):
- *"A `*` at the end, with a space before it, also matches the bare command."* So `Bash(npm test *)` matches both `npm test` and `npm test -- foo`. A rule with no `*` matches exactly.
- *"a rule like `Bash(safe-cmd *)` won't give it permission to run the command `safe-cmd && other-cmd`."* Separators are `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, and each subcommand must match on its own.
- `dontAsk`: *"Auto-denies every call that would otherwise prompt … File reads in your working directories and other actions that need no approval still run, as do tools pre-approved via … `permissions.allow` rules."*
