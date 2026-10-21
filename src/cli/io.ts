/** Everything the CLI touches in the outside world, injected so tests can capture it. */
export interface CliIO {
  readonly cwd: string;
  readonly now: () => Date;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}
