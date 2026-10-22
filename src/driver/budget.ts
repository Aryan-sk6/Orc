/**
 * The run-wide USD cap (`maxBudgetUsd`), shared by every session and driver call.
 * Costs are Agent SDK estimates. Each call is given `remaining()` as its own cap, so parallel
 * sessions can overshoot by up to one call each (Decisions/0006, 0011).
 */
export class RunBudget {
  private spentUsd: number;

  constructor(
    readonly capUsd: number,
    alreadySpentUsd = 0,
  ) {
    this.spentUsd = alreadySpentUsd;
  }

  get spent(): number {
    return this.spentUsd;
  }

  remaining(): number {
    return Math.max(0, this.capUsd - this.spentUsd);
  }

  exhausted(): boolean {
    return this.remaining() <= 0;
  }

  add(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > 0) {
      this.spentUsd += costUsd;
    }
  }
}
