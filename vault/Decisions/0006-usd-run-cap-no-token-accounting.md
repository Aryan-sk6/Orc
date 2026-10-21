---
date: 2026-10-21
status: accepted
supersedes: "token caps in [[0003-config-shape-and-defaults]]"
tags: [decision, config, budget]
---
# 0006: USD run cap, no custom token accounting

## Context
The original spec had per-task and per-run **token** caps. The Agent SDK has no enforced token cap. Its only hard spend limit is `maxBudgetUsd`, an estimated USD figure (see [[claude-agent-sdk]]). The user chose simplicity: "No custom token accounting."

## Decision
- **Config:** a top-level `maxBudgetUsd` (number > 0, default **20**) is the run-wide cap. `retries.maxPerTask` (default 2) stays. `budgets.perTaskTokens/perRunTokens` are removed, and a leftover `budgets` key is an unknown-key error.
- **Cost source:** the SDK **does** give cost per turn. Every `result` message carries `total_cost_usd`, an estimate that includes subagents. Two things to watch:
  - On a **resumed** session, or in **streaming-input** mode, the value is **cumulative** for that session. Per-turn cost is therefore `current total − previous total` for that session. Never sum raw results.
  - After a crash, an `error_during_execution` result may carry **zeroed** totals. Keep the previous value.
- **Storage:** each session note's frontmatter has `costUsd`, the running sum of that session's coding turns plus its driver calls, rounded to 4 decimals. `orc status` shows a `COST` column and a line reading `Spend: $x of $y run cap (…%), estimated by the Agent SDK, not billing data`.
- **Enforcement (M4):** each SDK call gets `maxBudgetUsd = cap − spent so far (all sessions)`. A result with `error_max_budget_usd`, or the run total reaching the cap, triggers an entry in `decisions.md` and pauses the session(s), while other sessions continue as long as budget remains. A retry cap that's hit does the same for that session.

## Known limits (accepted)
- These are estimates, not billing data. The authoritative source is the Claude Console.
- The SDK checks the cap after each response, so one response can overshoot it.
- **Parallel sessions:** the SDK cap is per call, and concurrent calls each see the same remaining budget, so the run can overshoot by up to one call per active session. M4 can tighten this by dividing the remaining budget across active sessions if needed.

## Consequences
- No token counting code anywhere in orc.
- Default `maxBudgetUsd: 20` is a guess for small apps and is reversible. Revisit it with the M6 dogfood numbers.
