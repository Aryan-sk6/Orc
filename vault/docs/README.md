---
tags: [docs]
---
# Fetched and pasted docs

This folder holds current third-party docs, so agents don't rely on stale training data. Keep one file per library, for example `claude-agent-sdk.md`. Each file records its source URLs, fetch date and the package version it was read against. The user may also paste docs here.

| Doc | Needed by | Status |
|---|---|---|
| [[claude-agent-sdk]]: `@anthropic-ai/claude-agent-sdk` (TypeScript) | M3, M4 (M2 if the planner uses the SDK) | ✅ fetched 2026-10-21 from code.claude.com and trimmed. Read against 0.3.306. Has a "Gaps" section |
