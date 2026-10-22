/** Everything the CLI touches in the outside world, injected so tests can capture it. */
export interface CliIO {
  readonly cwd: string;
  readonly now: () => Date;
  /** Environment variables (process.env in the real CLI). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Prints `prompt`, then reads one line from stdin. Resolves null at end of input. */
  readonly readLine: (prompt: string) => Promise<string | null>;
  /** Aborted on the first Ctrl-C / SIGTERM so long-running commands can stop cleanly. */
  readonly signal?: AbortSignal | undefined;
  /** This process's id (process.pid in the real CLI). Recorded by `orc run` so `orc stop` can find it. */
  readonly pid?: number | undefined;
  /** Sends a signal to a process (process.kill in the real CLI; signal 0 only tests it exists). */
  readonly kill?: ((pid: number, signal: NodeJS.Signals | 0) => void) | undefined;
}
