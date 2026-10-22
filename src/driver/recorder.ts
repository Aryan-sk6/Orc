import type { VaultPaths } from "../vault/layout.js";
import { appendLog, formatTimestamp } from "../vault/log.js";
import {
  appendToSessionSection,
  roundUsd,
  type SessionSection,
  type SessionState,
  writeSessionState,
} from "../vault/session-note.js";

/** LOG lines stay short so one append stays atomic and the log stays readable. */
const MAX_LOG_CHARS = 220;
const MAX_LOG_FILES = 8;

/**
 * Everything one session writes to the MAIN vault: its own note (state + sections) and LOG lines.
 * Only this session's loop calls it, so the note has a single writer (Decisions/0010, 0011).
 */
export class SessionRecorder {
  private current: SessionState;

  constructor(
    private readonly vault: VaultPaths,
    initial: SessionState,
    private readonly now: () => Date,
  ) {
    this.current = initial;
  }

  get state(): SessionState {
    return this.current;
  }

  /** Merges `patch` into the state, stamps `updated` and writes the note. */
  async update(
    patch: Partial<Omit<SessionState, "session" | "workstream" | "branch">>,
  ): Promise<void> {
    const costUsd = patch.costUsd === undefined ? this.current.costUsd : roundUsd(patch.costUsd);
    this.current = { ...this.current, ...patch, costUsd, updated: formatTimestamp(this.now()) };
    await writeSessionState(this.vault, this.current);
  }

  async addCost(costUsd: number): Promise<void> {
    await this.update({ costUsd: this.current.costUsd + costUsd });
  }

  async note(section: SessionSection, text: string): Promise<void> {
    await appendToSessionSection(this.vault, this.current.session, section, text, this.now());
  }

  async log(did: string, touching: readonly string[] = []): Promise<void> {
    const shown = touching.slice(0, MAX_LOG_FILES);
    const more = touching.length - shown.length;
    await appendLog(this.vault, {
      session: this.current.session,
      did: did.length <= MAX_LOG_CHARS ? did : `${did.slice(0, MAX_LOG_CHARS - 1)}…`,
      touching: more > 0 ? [...shown, `+${more} more`] : shown,
      now: this.now(),
    });
  }
}
