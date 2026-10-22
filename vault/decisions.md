# Decisions

Escalations from drivers. Change `[open]` to `[resolved]` once handled.

## D-001 [resolved] 2026-10-22 19:40 · m5
- Question: One full `npm run check` run during M5 had one failing test that could not be reproduced (11 clean runs after it). Which test, and why?
- Default taken: Investigated before M6. 20 sequential full runs: 20 clean (slowest test 1.4s). Then 6 suites in parallel (a loaded machine): 24 of 24 runs failed with 13 to 17 failures each, nearly all `Error: Test timed out in 5000ms.`, in the tests that run real git (src/rewind, src/integration, src/git, src/driver/run, and the CLI tests for rewind, run and integrate). A timed-out test keeps running while the afterEach deletes its temp folder, which adds `ENOTEMPTY: directory not empty, rmdir` errors. The M5 failure was most likely one such timeout under load; the exact test was not recorded. Fixed in vitest.config.ts (testTimeout and hookTimeout 30s) and test/helpers/tmp-dir.ts (rm with retries). After the fix, 6 parallel full runs pass 6 of 6 (322 tests each). No test is quarantined.
- Reversible: yes
