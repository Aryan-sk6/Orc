# agents.md: orc

This is the guide for any coding agent working on **orc**, a TypeScript CLI that orchestrates AI coding sessions to build an app from one plan. The scope is in `vault/Context/Spec.md` and the current milestone is in `vault/Context/Roadmap.md`.

## Stack (one line per library)
- **Node ≥ 20**, ESM only (`"type": "module"`). Use `node:` builtins for fs, path, child_process, events and util.
- **TypeScript 7** in strict mode with extra strictness (see `tsconfig.json`). It uses `NodeNext` modules, so relative imports end in `.js`.
- **`node:util` `parseArgs`** handles CLI argument parsing. No CLI framework.
- **Vitest 4** runs the tests. It's pinned below v5 because v5 drops Node 20.
- **Biome 2** does linting and formatting in one tool. `noExplicitAny` and `noNonNullAssertion` are errors.
- **`@anthropic-ai/claude-agent-sdk`** comes in M3 and may only be used inside `src/agents/claude-sdk.ts`. Read `vault/docs/claude-agent-sdk.md` before touching it.
- **Runtime dependencies: none.** Adding one needs a decision note in `vault/Decisions/`.

## Commands
```
npm run typecheck   # tsc on src + tests, no emit
npm run lint        # biome check (lint + format check)
npm run format      # biome check --write
npm test            # vitest run
npm run build       # tsc -p tsconfig.build.json → dist/
npm run check       # typecheck + lint + test (run before every commit)
node dist/cli/index.js --help
```

## Folder structure
```
agents.md                 this file
CLAUDE.md                 pointer for Claude Code sessions
orc.config.example.json   every config key with its default
src/
  cli/
    index.ts              bin entry (shebang); calls main() and sets the exit code. No logic here.
    main.ts               argv → command dispatch; takes injected CliIO so it's testable
  config/
    types.ts              OrcConfig and OrcConfigInput interfaces
    defaults.ts           DEFAULT_CONFIG and DEFAULT_CHECK_TIMEOUT_MS
    validate.ts           unknown → OrcConfigInput, with path-aware ConfigIssue[]
    load.ts               find file → parse JSON → validate → merge defaults
  core/
    errors.ts             OrcError(code, message, details)
test/fixtures/            static fixtures (configs/ …)
vault/                    project memory for developing orc (Obsidian)

Planned (not created yet):
  src/vault/              M1: LOG writer, session notes, decisions, rules (target-app vault)
  src/cli/commands/       M1: one file per command
  src/planner/            M2: orc plan, orc check-setup
  src/agents/             M3: adapter.ts (AgentAdapter), fake.ts (FakeAgentAdapter), claude-sdk.ts
  src/git/                M3: worktrees, branches, checkpoint tags
  src/checks/             M4: run check commands, parse results
  src/driver/             M4: driver loop, budgets, retries, escalation
  src/integration/        M5: integration driver
  src/summarize/          M5: orc summarize
```

## Hard rules
- **No `any`.** At every boundary (JSON, CLI args, SDK output), take `unknown` and narrow it with a type guard or validator. Avoid `as` casts. The only exceptions are `as const` and narrowing an already-validated value, and those need a one-line comment explaining why.
- **Explicit interfaces** for every exported shape. Exported functions get explicit return types. Config and plan data are `readonly`.
- **LLM calls only in `src/planner/` and `src/driver/`**, and always through `AgentAdapter`. Every other module is deterministic and must not import the SDK.
- **Never guess an SDK API.** If `vault/docs/` doesn't cover a call, stop and ask the user to paste the docs.
- **Event-driven only.** No `setInterval` or sleep-and-check loops. React to adapter events, child-process exits and promises.
- **Tests never hit the network or spend tokens.** Agent behaviour in tests comes from `FakeAgentAdapter` with scripted outputs.
- **Dependency injection at the edges.** Pass `cwd`, paths, the clock (`now: () => Date`) and the adapter in as parameters. Don't read `process.cwd()`, `Date.now()` or `process.env` deep inside modules.
- **Errors:** throw `OrcError` with a code from `OrcErrorCode`. Only `src/cli/` prints to the terminal or sets the exit code. Library code never calls `process.exit` or `console.log`.

## Patterns
- **File naming:** kebab-case files, camelCase functions, PascalCase types with no `I` prefix. Don't write barrel `index.ts` re-exports, import from the specific file. The exception is `src/cli/index.ts`, which is the bin.
- **Validation:** hand-written validators in the `config/validate.ts` style. Reject unknown keys, report every issue (not just the first) with a dotted path such as `budgets.perTaskTokens`, then merge with defaults. Arrays from user input replace defaults; they are not merged.
- **Results vs. throws:** validators return `{ ok: true, value } | { ok: false, issues }`. Loaders and commands throw `OrcError`.
- **Tests:** colocate them as `foo.test.ts` next to `foo.ts`. Use `test/fixtures/` for static files and `fs.mkdtemp(os.tmpdir())` for anything written, cleaned up in `afterEach`. Assert behaviour, not implementation.
- **Vault writes (M1+):** append-only for `LOG.md`. Write other files atomically (temp file plus `rename`). Every LOG line follows `[YYYY-MM-DD HH:mm][session] did X | touching: files`.
- **Git:** use Conventional Commits (`feat(config): …`, `chore: …`, `docs(vault): …`). Commit after each completed step, after `npm run check` passes.

## Project memory
Read `vault/Home.md` at the start of every session and follow the end-of-session steps in `CLAUDE.md`. Record decisions in `vault/Decisions/` and append a line to `vault/LOG.md` for each step.
