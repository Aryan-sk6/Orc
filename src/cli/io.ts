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
}
