---
date: 2026-10-21
status: accepted (defaults reversible)
tags: [decision, config]
---
# 0003: `orc.config.json` shape and defaults

## Context
The spec lists the config contents: planner model, driver model (a cheap one by default), per-task token cap, per-run token cap, retry cap (default 2) and check commands. Some details were left open.

## Decision
The shape is documented in [[Config]]. These are the choices beyond the spec:
- **`checks` is an ordered array** of `{name, command, timeoutMs}` rather than a fixed typecheck/lint/test/build map. Order is execution order, so a target app can have any set of checks. If the user gives `checks`, it **replaces** the defaults rather than merging with them.
- **`adapter: "claude-agent-sdk" | "fake"`** lets dev runs use FakeAgentAdapter from config.
- **`vaultDir`** (default `vault`) resolves against the config file's directory.
- **Unknown keys are errors**, which catches typos like `perRunTokns`.
- **Cross-field rule:** `perTaskTokens ≤ perRunTokens`.
- A missing `orc.config.json` means all defaults. A missing `--config <path>` is an error.
- **Default models:** planner `claude-opus-5-5` (best quality, rarely called), driver `claude-haiku-5-5` (cheapest current model).
- **Default token caps:** 500k per task, 10M per run. These are placeholders, see [[Open Questions]].

## Alternatives considered
- Merging user `checks` into the defaults by name. Rejected because there's no clean way to remove a default check.
- Allowing extra keys for forward compatibility. Rejected because silent typos in budget settings are costly.

## Consequences
- `orc.config.example.json` must stay identical to `DEFAULT_CONFIG`. A test enforces this.
- What counts toward the token caps (input, output, cached reads, driver tokens) is decided in M4.
