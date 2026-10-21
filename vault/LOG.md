# LOG

One line per update, newest last, in the format `[time][session] did X | touching: files`.

[2026-10-21 23:10][setup] git init, added origin, created vault | touching: .git, vault/, CLAUDE.md, .gitignore
[2026-10-21 23:19][m0] saved spec, roadmap, rules, docs list | touching: vault/Context/Spec.md, vault/Context/Roadmap.md, vault/rules.md, vault/docs/README.md
[2026-10-21 23:23][m0] project skeleton: package.json, tsconfig, biome, vitest, CLI entry (--help/--version) | touching: package.json, tsconfig*.json, biome.json, vitest.config.ts, src/cli/, src/core/errors.ts
[2026-10-21 23:25][m0] config loader: types, defaults, validator (all issues, dotted paths, unknown keys), loadConfig, orc config cmd, 36 tests | touching: src/config/, src/cli/main.ts, src/core/errors.ts, orc.config.example.json, test/fixtures/configs/, biome.json, agents.md
[2026-10-21 23:26][m0] M0 done: decisions 0002/0003, config reference, session note, Home + open questions | touching: vault/
[2026-10-21 23:32][m1] renamed master→main (no push until after M6); fetched + trimmed Claude Agent SDK docs (0.3.306); recorded M7 kit in spec addendum + roadmap | touching: vault/docs/claude-agent-sdk.md, vault/Context/Spec.md, vault/Context/Roadmap.md, vault/Decisions/0004-*
[2026-10-21 23:37][m1] vault module: layout, frontmatter, LOG writer/reader, session notes, decisions, ensureVault; fixed biome ignore that skipped src/vault | touching: src/vault/, src/core/fs.ts, src/core/errors.ts, test/helpers/tmp-dir.ts, biome.json
[2026-10-21 23:40][m1] CLI scaffolding: command registry, status (table/--json) on fake demo vault, log (append/--tail), config moved to commands/ | touching: src/cli/, test/fixtures/demo/, test/helpers/cli.ts, agents.md, package.json
[2026-10-21 23:41][m1] M1 done: session note, decision 0005, roadmap/home/open questions updated | touching: vault/
[2026-10-21 23:47][m1] budgets simplified: dropped token caps; run cap is maxBudgetUsd (USD, SDK estimate) + retry cap; status shows per-session COST and spend vs cap | touching: src/config/, src/vault/session-note.ts, src/cli/commands/status.ts, orc.config.example.json, test/fixtures/
[2026-10-21 23:48][m1] recorded user answers: decisions 0006 (USD run cap) + 0007 (shared planner prompt, API key); roadmap moves AgentAdapter+Fake into M2 | touching: vault/, agents.md
[2026-10-21 23:56][m2] AgentAdapter interface, FakeAgentAdapter + JSON fake script loader, createAdapter, fakeScript config key | touching: src/agents/, src/config/, src/core/errors.ts, orc.config.example.json
