import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Many tests run real git and real shell commands (about 1s alone). Under load, for example
    // several suites at once, the 5s default made them time out; no test asserts on speed.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
