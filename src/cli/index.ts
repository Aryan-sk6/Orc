#!/usr/bin/env node
import { main } from "./main.js";
import { createLineReader } from "./terminal.js";

const write = (text: string): void => {
  process.stdout.write(text);
};
const stdin = createLineReader(process.stdin, write);
// First Ctrl-C / SIGTERM asks running commands to stop cleanly; a second one exits at once.
const interrupt = new AbortController();
for (const name of ["SIGINT", "SIGTERM"] as const) {
  process.on(name, () => {
    if (interrupt.signal.aborted) {
      process.exit(130);
    }
    process.stderr.write("\norc: stopping… (press Ctrl-C again to force quit)\n");
    interrupt.abort();
  });
}
try {
  process.exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    now: () => new Date(),
    env: process.env,
    stdout: write,
    stderr: (text) => process.stderr.write(text),
    readLine: stdin.readLine,
    signal: interrupt.signal,
  });
} finally {
  stdin.close();
}
