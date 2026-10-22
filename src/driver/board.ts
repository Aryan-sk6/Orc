/** Why a task's dependencies can never be met. */
export interface Blocked {
  /** Needed tasks that are not done and whose workstream has stopped working. */
  readonly missing: readonly string[];
}

interface Waiter {
  readonly needs: readonly string[];
  readonly resolve: (blocked: Blocked | null) => void;
}

/**
 * Tracks finished tasks across workstreams so a task can wait for its `needs` without polling.
 * Waiters are re-checked only when a task finishes or a workstream stops.
 */
export class TaskBoard {
  private readonly done = new Set<string>();
  private readonly stopped = new Set<string>();
  private waiters: Waiter[] = [];

  constructor(
    doneRefs: Iterable<string> = [],
    /** Workstream name of a task ref ("api/T2" → "api"). */
    private readonly workstreamOf: (ref: string) => string = defaultWorkstreamOf,
  ) {
    for (const ref of doneRefs) {
      this.done.add(ref);
    }
  }

  isDone(ref: string): boolean {
    return this.done.has(ref);
  }

  markDone(ref: string): void {
    this.done.add(ref);
    this.recheck();
  }

  /** The workstream finished, paused or stopped: it will not complete any more tasks. */
  markStopped(workstream: string): void {
    this.stopped.add(workstream);
    this.recheck();
  }

  /** Resolves null when every need is done, or with the missing refs if they can never finish. */
  waitFor(needs: readonly string[]): Promise<Blocked | null> {
    const blocked = this.evaluate(needs);
    if (blocked !== undefined) {
      return Promise.resolve(blocked);
    }
    return new Promise((resolve) => {
      this.waiters.push({ needs, resolve });
    });
  }

  /** undefined = keep waiting. */
  private evaluate(needs: readonly string[]): Blocked | null | undefined {
    const pending = needs.filter((ref) => !this.done.has(ref));
    if (pending.length === 0) {
      return null;
    }
    const missing = pending.filter((ref) => this.stopped.has(this.workstreamOf(ref)));
    return missing.length > 0 ? { missing } : undefined;
  }

  private recheck(): void {
    const stillWaiting: Waiter[] = [];
    for (const waiter of this.waiters) {
      const outcome = this.evaluate(waiter.needs);
      if (outcome === undefined) {
        stillWaiting.push(waiter);
      } else {
        waiter.resolve(outcome);
      }
    }
    this.waiters = stillWaiting;
  }
}

function defaultWorkstreamOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(0, slash);
}
