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
    main.ts               argv → command dispatch, global help/version, OrcError → exit code
    io.ts                 CliIO: cwd, now(), stdout, stderr (injected so tests capture them)
    args.ts               GLOBAL_OPTIONS, splitCommandLine, parseCommandArgs (strict, typed per command)
    command.ts            Command interface: name, summary, help, run(argv, io)
    registry.ts           COMMANDS list; add new commands here
    table.ts              renderTable for terminal tables
    commands/             one file per command: status.ts, log.ts, config.ts (+ *.test.ts)
  config/
    types.ts              OrcConfig and OrcConfigInput interfaces
    defaults.ts           DEFAULT_CONFIG and DEFAULT_CHECK_TIMEOUT_MS
    validate.ts           unknown → OrcConfigInput, with path-aware ConfigIssue[]
    load.ts               find file → parse JSON → validate → merge defaults
  core/
    errors.ts             OrcError(code, message, details), errorCode(), errorMessage()
    fs.ts                 readFileIfExists, writeFileAtomic, writeFileIfMissing, KeyedMutex
  vault/                  the TARGET app's vault (what orc reads/writes at runtime)
    layout.ts             VAULT_LAYOUT names, vaultPaths(), session-name rules
    frontmatter.ts        flat key: scalar frontmatter parse/serialize
    log.ts                LOG.md line format, appendLog, readLogTail
    session-note.ts       SessionState frontmatter + Progress/Problems/Decisions sections
    decisions.ts          numbered escalations in decisions.md
    init.ts               ensureVault: create layout + seed files, never overwrite
test/
  helpers/                tmp-dir.ts (useTmpDir, localTime), cli.ts (captureIO)
  fixtures/               configs/, demo/ (fake vault for `orc status`; npm run demo:status)
vault/                    project memory for developing orc (Obsidian). NOT the target vault.

Planned (not created yet):
  src/planner/            M2: orc plan (shared planner prompt file, also used by M7 /orc-plan), orc check-setup
  src/agents/             M2: adapter.ts (AgentAdapter), fake.ts (FakeAgentAdapter); M3: claude-sdk.ts
  src/git/                M3: worktrees, branches, checkpoint tags
  src/checks/             M4: run check commands, parse results
  src/driver/             M4: driver loop, USD run cap (SDK maxBudgetUsd), retries, escalation
  src/integration/        M5: integration driver
  src/summarize/          M5: orc summarize
```

## Hard rules

- **No `any`.** At every boundary (JSON, CLI args, SDK output), take `unknown` and narrow it with a type guard or validator. Avoid `as` casts. The only exceptions are `as const` and narrowing an already-validated value, and those need a one-line comment explaining why.
- **Explicit interfaces** for every exported shape. Exported functions get explicit return types. The one exception is a thin wrapper whose type comes from a generic library call, such as `parseCommandArgs`. Config and plan data are `readonly`.
- **LLM calls only in `src/planner/` and `src/driver/`**, and always through `AgentAdapter`. Every other module is deterministic and must not import the SDK.
- **Never guess an SDK API.** If `vault/docs/` doesn't cover a call, stop and ask the user to paste the docs.
- **Event-driven only.** No `setInterval` or sleep-and-check loops. React to adapter events, child-process exits and promises.
- **Tests never hit the network or spend tokens.** Agent behaviour in tests comes from `FakeAgentAdapter` with scripted outputs.
- **Dependency injection at the edges.** Pass `cwd`, paths, the clock (`now: () => Date`) and the adapter in as parameters. Don't read `process.cwd()`, `Date.now()` or `process.env` deep inside modules.
- **Errors:** throw `OrcError` with a code from `OrcErrorCode`. Only `src/cli/` prints to the terminal or sets the exit code. Library code never calls `process.exit` or `console.log`.

## Patterns

- **File naming:** kebab-case files, camelCase functions, PascalCase types with no `I` prefix. Don't write barrel `index.ts` re-exports, import from the specific file. The exception is `src/cli/index.ts`, which is the bin.
- **Validation:** hand-written validators in the `config/validate.ts` style. Reject unknown keys, report every issue (not just the first) with a dotted path such as `retries.maxPerTask`, then merge with defaults. Arrays from user input replace defaults; they are not merged.
- **Index signatures:** read them with brackets (`raw["checks"]`), as `noPropertyAccessFromIndexSignature` requires. Biome's `useLiteralKeys` is off because it conflicts with that setting.
- **Results vs. throws:** validators return `{ ok: true, value } | { ok: false, issues }`. Loaders and commands throw `OrcError`.
- **Tests:** colocate them as `foo.test.ts` next to `foo.ts`. Use `test/fixtures/` for static files and `fs.mkdtemp(os.tmpdir())` for anything written, cleaned up in `afterEach`. Assert behaviour, not implementation.
- **Vault writes:** use `src/vault/*` and never hand-roll paths or formats. `LOG.md` is append-only, with one `appendFile` per line. Other files are written atomically with `writeFileAtomic`, and read-modify-write goes through a `KeyedMutex`. Every LOG line follows `[YYYY-MM-DD HH:mm][session] did X | touching: files`. Session state lives in session-note frontmatter, and `orc status` reads only the vault.
- **New CLI command:** add `src/cli/commands/<name>.ts` that exports a `Command`, register it in `registry.ts`, and parse options with `parseCommandArgs`. Command options go _after_ the command name.
- **Timestamps** come from the injected `now()` and are formatted with `formatTimestamp` (local `YYYY-MM-DD HH:mm`). Tests use `localTime()` so they pass in any time zone.
- **Git:** use Conventional Commits (`feat(config): …`, `chore: …`, `docs(vault): …`). Commit after each completed step, after `npm run check` passes.

## Project memory

Read `vault/Home.md` at the start of every session and follow the end-of-session steps in `CLAUDE.md`. Record decisions in `vault/Decisions/` and append a line to `vault/LOG.md` for each step.
