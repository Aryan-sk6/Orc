---
date: 2026-10-21
status: accepted
tags: [decision]
---
# 0002: Tooling and dependencies

## Context
The spec asks for TypeScript strict mode with no `any`, Node 20+, minimal dependencies and Vitest. This decision picks the toolchain for M0.

## Decision
- **Runtime dependencies: none** until M3 brings in `@anthropic-ai/claude-agent-sdk`.
- **CLI parsing: `node:util` `parseArgs`.** It's built in and good enough for subcommands plus a few flags.
- **Config validation: hand-written validators** rather than zod. The config is small, explicit interfaces were required, and this avoids a dependency.
- **TypeScript 7.0.2**, the native compiler. On top of `strict` it also enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax`.
- **Vitest 4.1.12, not 5.** Vitest 5 requires Node ≥ 22.12, which would break "Node 20+" even for contributors.
- **@types/node 20.x**, so code can't use APIs that Node 20 lacks.
- **Biome 2.6.2** handles lint and format in one dev dependency. `noExplicitAny` and `noNonNullAssertion` are errors. `useLiteralKeys` is off because it conflicts with `noPropertyAccessFromIndexSignature`.
- Dev dependency versions are pinned exactly.

## Alternatives considered
- **ESLint + typescript-eslint:** more common, but more packages and config. The user approved Biome.
- **zod:** good ergonomics, but it's a runtime dependency for one small config file.
- **commander/yargs:** unnecessary given `parseArgs`.

## Consequences
- Biome 2.6 also formats **Markdown** (it inserts a blank line after headings). `vault/` is excluded through `files.includes`, but root `.md` files are formatted.
- A dependency's major-version bump, such as Vitest 5, waits until Node 20 support is dropped.
