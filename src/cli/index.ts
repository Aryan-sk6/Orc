#!/usr/bin/env node
import { main } from "./main.js";
import { createLineReader } from "./terminal.js";

const write = (text: string): void => {
  process.stdout.write(text);
};
const stdin = createLineReader(process.stdin, write);
try {
  process.exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    now: () => new Date(),
    env: process.env,
    stdout: write,
    stderr: (text) => process.stderr.write(text),
    readLine: stdin.readLine,
  });
} finally {
  stdin.close();
}
