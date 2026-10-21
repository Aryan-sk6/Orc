import { createInterface, type Interface } from "node:readline";

export interface LineReader {
  readonly readLine: (prompt: string) => Promise<string | null>;
  /** Releases stdin so the process can exit. Safe to call when nothing was read. */
  readonly close: () => void;
}

/**
 * Reads stdin line by line, opening it only on first use so commands that never ask
 * don't hold the process open. Works for a TTY and for piped input (null at EOF).
 */
export function createLineReader(
  input: NodeJS.ReadableStream,
  write: (text: string) => void,
): LineReader {
  let reader: Interface | undefined;
  let lines: AsyncIterator<string> | undefined;
  return {
    readLine: async (prompt) => {
      if (reader === undefined || lines === undefined) {
        reader = createInterface({ input, terminal: false });
        lines = reader[Symbol.asyncIterator]();
      }
      write(prompt);
      const next = await lines.next();
      return next.done === true ? null : next.value;
    },
    close: () => {
      reader?.close();
    },
  };
}
