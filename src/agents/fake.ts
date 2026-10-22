import { OrcError } from "../core/errors.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentOutcome,
  AgentTurnRequest,
  AgentTurnResult,
} from "./adapter.js";

/** One scripted reply. Turns are consumed in order, one per `runTurn` call. */
export interface FakeTurn {
  /** If set, the request's prompt must contain this text, or the turn fails loudly. */
  readonly expect?: string | undefined;
  readonly text: string;
  readonly outcome?: AgentOutcome | undefined;
  readonly costUsd?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly errors?: readonly string[] | undefined;
  readonly deniedActions?: readonly string[] | undefined;
  /** Overrides the session id; by default a resume keeps its id and a new turn gets a fresh one. */
  readonly sessionId?: string | undefined;
  /** Progress events emitted before the result, after the "session" event. */
  readonly events?: readonly AgentEvent[] | undefined;
}

export interface FakeScript {
  readonly turns: readonly FakeTurn[];
}

/**
 * Replays scripted outputs so tests and dev runs spend no tokens.
 * Every request is recorded in `requests` for assertions.
 */
export class FakeAgentAdapter implements AgentAdapter {
  readonly name = "fake";
  readonly requests: AgentTurnRequest[] = [];
  private readonly turns: readonly FakeTurn[];
  private next = 0;
  private sessions = 0;
  private closed = false;

  constructor(script: FakeScript) {
    this.turns = script.turns;
  }

  /** Scripted turns not consumed yet. */
  get remaining(): number {
    return this.turns.length - this.next;
  }

  async runTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    if (this.closed) {
      throw new OrcError("FAKE_SCRIPT_MISMATCH", "fake adapter: runTurn called after close()");
    }
    const index = this.next;
    const turn = this.turns[index];
    if (turn === undefined) {
      throw new OrcError(
        "FAKE_SCRIPT_EXHAUSTED",
        `fake adapter: no scripted turn left for call ${index + 1} (script has ${this.turns.length})`,
        [`prompt starts with: ${request.prompt.slice(0, 120)}`],
      );
    }
    this.next += 1;
    this.requests.push(request);

    if (turn.expect !== undefined && !request.prompt.includes(turn.expect)) {
      throw new OrcError(
        "FAKE_SCRIPT_MISMATCH",
        `fake adapter: turn ${index + 1} expected the prompt to contain "${turn.expect}"`,
        [`prompt starts with: ${request.prompt.slice(0, 120)}`],
      );
    }

    const sessionId = turn.sessionId ?? request.resumeSessionId ?? this.newSessionId();
    const outcome = turn.outcome ?? "success";
    if (request.signal?.aborted === true) {
      return result(sessionId, "error", "", 0, 0, ["aborted"], []);
    }

    request.onEvent?.({ type: "session", sessionId });
    for (const event of turn.events ?? []) {
      request.onEvent?.(event);
    }
    return result(
      sessionId,
      outcome,
      outcome === "success" ? turn.text : "",
      turn.costUsd ?? 0,
      turn.durationMs ?? 0,
      turn.errors ?? [],
      turn.deniedActions ?? [],
    );
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private newSessionId(): string {
    this.sessions += 1;
    return `fake-session-${this.sessions}`;
  }
}

function result(
  sessionId: string,
  outcome: AgentOutcome,
  text: string,
  costUsd: number,
  durationMs: number,
  errors: readonly string[],
  deniedActions: readonly string[],
): AgentTurnResult {
  return { sessionId, outcome, text, costUsd, durationMs, errors, deniedActions };
}
