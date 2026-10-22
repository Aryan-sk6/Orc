# agents.md: orc

This is the guide for any coding agent working on **orc**, a TypeScript CLI that orchestrates AI coding sessions to build an app from one plan. The scope is in `vault/Context/Spec.md` and the current milestone is in `vault/Context/Roadmap.md`.

## Stack (one line per library)

- **Node ≥ 20**, ESM only (`"type": "module"`). Use `node:` builtins for fs, path, child_process, events and util.
- **TypeScript 7** in strict mode with extra strictness (see `tsconfig.json`). It uses `NodeNext` modules, so relative imports end in `.js`.
- **`node:util` `parseArgs`** handles CLI argument parsing. No CLI framework.
- **Vitest 4** runs the tests. It's pinned below v5 because v5 drops Node 20.
- **Biome 2** does linting and formatting in one tool. `noExplicitAny` and `noNonNullAssertion` are errors. It skips `*.md`: its Markdown formatter rewrites frontmatter, even inside fenced blocks.
- **`@anthropic-ai/claude-agent-sdk` 0.3.308** (pinned exactly) is the only runtime dependency. Only `src/agents/claude-sdk.ts` imports it (its test may `import type`), and `createAdapter` loads it lazily. Read `vault/docs/claude-agent-sdk.md` and decision 0009 before touching it.
- **Adding any other runtime dependency** needs a decision note in `vault/Decisions/`.

## Commands

```
npm run typecheck   # tsc on src + tests, no emit
npm run lint        # biome check (lint + format check)
npm run format      # biome check --write
npm test            # vitest run
npm run build       # tsc -p tsconfig.build.json → dist/
npm run check       # typecheck + lint + test (run before every commit)
npm run demo:status # orc status on the fake demo vault
npm run demo:plan   # orc plan on the todo fixture with the fake adapter (writes .demo/, gitignored)
npm run smoke:sdk   # LIVE: 3 cheap turns through the real SDK adapter. Spends cents; needs ANTHROPIC_API_KEY. Never in tests.
node dist/cli/index.js --help
```

## Folder structure

```
agents.md                 this file
CLAUDE.md                 pointer for Claude Code sessions
orc.config.example.json   every config key with its default
kit/                      ships in the npm package; M7 adds the rest of the kit here
  prompts/planner.md      THE planner prompt, shared by `orc plan` and M7's /orc-plan. Says WHAT to produce.
  prompts/driver.md       THE driver prompt: fix or escalate after a failed check, JSON reply.
  prompts/summary.md      THE summary prompt, shared by `orc summarize` and M7's /orc-summarize: four fixed sections.
src/
  cli/
    index.ts              bin entry (shebang); calls main() and sets the exit code. No logic here.
    main.ts               argv → command dispatch, global help/version, OrcError → exit code
    io.ts                 CliIO: cwd, now(), env, stdout, stderr, readLine, signal (Ctrl-C) (injected so tests capture them)
    terminal.ts           lazy readline LineReader for stdin (null at EOF, works piped)
    args.ts               GLOBAL_OPTIONS, splitCommandLine, parseCommandArgs (strict, typed per command)
    command.ts            Command interface: name, summary, help, run(argv, io)
    registry.ts           COMMANDS list; add new commands here
    table.ts              renderTable for terminal tables
    commands/             one file per command: plan, check-setup, run, integrate, rewind, summarize, status, log, config (+ *.test.ts)
  config/
    types.ts              OrcConfig and OrcConfigInput interfaces
    defaults.ts           DEFAULT_CONFIG and DEFAULT_CHECK_TIMEOUT_MS
    validate.ts           unknown → OrcConfigInput, with path-aware ConfigIssue[]
    load.ts               find file → parse JSON → validate → merge defaults
  core/
    errors.ts             OrcError(code, message, details), errorCode(), errorMessage()
    fs.ts                 readFileIfExists, writeFileAtomic, writeFileIfMissing, KeyedMutex
    env-file.ts           minimal .env parser for presence checks
  agents/
    adapter.ts            AgentAdapter: runTurn(request) → {sessionId, outcome, text, costUsd per turn, deniedActions}, close(). No SDK imports.
    claude-sdk.ts         ClaudeSdkAdapter: THE only SDK import. Access → permission mode, cumulative cost → per-turn delta, result → outcome
    fake.ts               FakeAgentAdapter: replays FakeTurn[] in order, records requests, `expect` guards prompts
    fake-script.ts        loads a JSON fake script (config `fakeScript`); `textFile` for long replies
    create.ts             createAdapter(loadedConfig, env): fake or (lazily imported) SDK adapter; MISSING_API_KEY check
  planner/                LLM caller #1 (the driver in src/driver/ is #2)
    planner.ts            runPlanner: questions turn → ask user → plan turn (resumed) → validate → repair → write
    prompts.ts            loads kit/prompts/planner.md; builds the per-turn prompts
    protocol.ts           CLI-only reply formats: questions JSON, <<<orc-file path="…">>> blocks, path safety
    check-setup.ts        deterministic: API key, plan env vars (env/.env.local/.env), docs present
  git/                    deterministic git plumbing (execFile, no shell); no SDK, no LLM
    git.ts                git(args, {cwd, env, okExitCodes}) → GIT_FAILED with git's message
    worktrees.ts          openRepo, ensureWorktree (branch orc/<ws>, folder <repo>-orc-worktrees/<ws>), removeWorktree
    checkpoints.ts        commitAll, createCheckpoint (tag orc-cp/<ws>/<task>[.n]), list/find, rewindToCheckpoint (orc-backup/ tag first)
    changes.ts            changedFiles: edits + new files since HEAD, for LOG "touching:"
    integration.ts        orc-integration/<milestone> branch + worktree (_integration/), mergeBranch (conflict → abort), assertVaultUntracked
  integration/            `orc integrate`: NO model call. See vault Decisions/0012.
    integrate.ts          runIntegration: merge finished workstreams (deps first), installCommand, full checks, decisions on conflict/failure; session note "integration"
  rewind/
    rewind.ts             rewindWorkstream: worktree reset + backup tag, untick plan, reset session note (drops agentSession)
  summarize/              LLM caller #3 (read-only, driver model): `orc summarize`
    facts.ts              gatherFacts/renderFacts: sessions, decisions, spend tables from the vault (deterministic)
    prompts.ts            loads kit/prompts/summary.md; builds the prompt; validateSummary (four ## sections, in order)
    summarize.ts          runSummary: model narrative (repair turns, budget-capped) + tables → vault/report.md
  checks/
    run-checks.ts         runCheck/runChecks: shell command in a worktree, timeout + abort kill the process group, output tail
  driver/                 `orc run`: the loop. LLM caller #2, always via AgentAdapter. See vault Decisions/0011.
    run.ts                runDriver: worktrees, restored state, shared RunBudget, TaskBoard, all sessions in parallel
    session.ts            runSession: per task checkpoint → coding turn → checks → next task | driver fix | escalate
    prompts.ts            first-task, next-task, fix, driver prompts; loads kit/prompts/driver.md
    context.ts            reads agents.md, workstream note, contracts, docs, rules once per session; relevantDocs, clip
    reply.ts              parseDriverReply: the driver's JSON (fix | escalate)
    recorder.ts           SessionRecorder: the ONLY writer of one session's note and LOG lines (main vault)
    budget.ts             RunBudget: shared USD cap
    board.ts              TaskBoard: event-driven wait for cross-workstream `needs`
  vault/                  the TARGET app's vault (what orc reads/writes at runtime)
    layout.ts             VAULT_LAYOUT names, vaultPaths(), session-name rules
    frontmatter.ts        flat key: scalar frontmatter parse/serialize
    log.ts                LOG.md line format, appendLog, readLogTail
    session-note.ts       SessionState frontmatter + Progress/Problems/Decisions sections
    decisions.ts          numbered escalations in decisions.md
    init.ts               ensureVault: create layout + seed files, never overwrite
    plan.ts               plan format: parse setup/docs-needed/workstreams, validate task graph, render task-graph.md
scripts/
  smoke-sdk.mjs           opt-in live check of ClaudeSdkAdapter (npm run smoke:sdk); not part of the test suite
test/
  helpers/                tmp-dir.ts (useTmpDir, localTime), cli.ts (captureIO with env + scripted stdin), plan.ts, git.ts (isolated git env, initRepo), driver.ts (setupApp: temp repo + vault + plan; RoutedAdapter: per-workstream scripts)
  fixtures/               configs/, demo/ (fake vault for `orc status`), planner/ (todo idea, fake script, replies)
vault/                    project memory for developing orc (Obsidian). NOT the target vault.
```

## Hard rules

- **No `any`.** At every boundary (JSON, CLI args, SDK output), take `unknown` and narrow it with a type guard or validator. Avoid `as` casts. The only exceptions are `as const` and narrowing an already-validated value, and those need a one-line comment explaining why.
- **Explicit interfaces** for every exported shape. Exported functions get explicit return types. The one exception is a thin wrapper whose type comes from a generic library call, such as `parseCommandArgs`. Config and plan data are `readonly`.
- **LLM calls only in `src/planner/`, `src/driver/` and `src/summarize/`** (the last is a read-only narrative, see Decisions/0012), and always through `AgentAdapter`. Every other module is deterministic and must not import the SDK.
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
- **Plan format:** the plan is markdown in the target vault, parsed by `src/vault/plan.ts`. Formats orc acts on are strict: `` - `NAME`: purpose `` under `## Env vars`, `` - `file.md`: … `` under `## Docs`, and workstream notes with `## Goal/Owns/Tasks/Definition of done` and `- [ ] T1: title (needs: ws/T2)`. Change a format in three places together: the parser, `kit/prompts/planner.md`, and the fixture `test/fixtures/planner/plan-reply.md`.
- **Agent calls:** go through `AgentAdapter.runTurn`, pass the remaining `maxBudgetUsd`, and treat any non-`success` outcome as a failure. Validate every reply before acting on it, and give invalid replies at most `retries.maxPerTask` repair turns in the same session.
- **Timestamps** come from the injected `now()` and are formatted with `formatTimestamp` (local `YYYY-MM-DD HH:mm`). Tests use `localTime()` so they pass in any time zone.
- **Driver (`src/driver/`):** orc writes the vault, agents don't: each session's note and LOG lines go through its `SessionRecorder`, and finished tasks are ticked in the workstream note with `markTaskDone`. When checks pass, the next task is sent with no model call. Every agent call gets `maxBudgetUsd = budget.remaining()`. Tests script parallel sessions with `RoutedAdapter` (one fake per worktree folder), never one shared fake.
- **Integration, rewind, summarize:** `orc integrate` never calls a model and never resolves a conflict itself: it escalates through `appendDecision`. `orc rewind` resets the plan ticks and the session note together with the worktree, and drops `agentSession`. `orc` and `integration` are reserved workstream names. `orc run` and `orc integrate` refuse a git-tracked vault. The summary narrative must pass `validateSummary` (four `##` sections in order); the tables are always built by code.
- **Git plumbing (`src/git/`):** always pass `env` explicitly. Tests use `gitTestEnv()` so the developer's global git config never leaks in. orc's own commits use `--no-verify` and never invent an identity. Never delete a branch. See decision 0010.
- **Git:** use Conventional Commits (`feat(config): …`, `chore: …`, `docs(vault): …`). Commit after each completed step, after `npm run check` passes.

## Project memory

Read `vault/Home.md` at the start of every session and follow the end-of-session steps in `CLAUDE.md`. Record decisions in `vault/Decisions/` and append a line to `vault/LOG.md` for each step.
