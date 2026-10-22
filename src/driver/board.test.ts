import { describe, expect, it } from "vitest";
import { TaskBoard } from "./board.js";
import { RunBudget } from "./budget.js";

describe("TaskBoard", () => {
  it("resolves immediately when there is nothing to wait for or everything is done", async () => {
    const board = new TaskBoard(["api/T1"]);
    expect(await board.waitFor([])).toBeNull();
    expect(await board.waitFor(["api/T1"])).toBeNull();
  });

  it("wakes a waiter when the last needed task finishes", async () => {
    const board = new TaskBoard();
    let woke = false;
    const waiting = board.waitFor(["api/T1", "db/T2"]).then((result) => {
      woke = true;
      return result;
    });
    board.markDone("api/T1");
    await Promise.resolve();
    expect(woke).toBe(false);
    board.markDone("db/T2");
    expect(await waiting).toBeNull();
  });

  it("reports needs that can never finish once their workstream stopped", async () => {
    const board = new TaskBoard(["db/T1"]);
    const waiting = board.waitFor(["db/T1", "api/T2", "web/T1"]);
    board.markStopped("api");
    expect(await waiting).toEqual({ missing: ["api/T2"] });
  });

  it("does not treat a stopped workstream's finished tasks as missing", async () => {
    const board = new TaskBoard();
    board.markDone("api/T1");
    board.markStopped("api");
    expect(await board.waitFor(["api/T1"])).toBeNull();
  });

  it("keeps waiting while the needed workstream is still running", async () => {
    const board = new TaskBoard();
    let settled = false;
    void board.waitFor(["api/T2"]).then(() => {
      settled = true;
    });
    board.markStopped("web");
    board.markDone("api/T1");
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("RunBudget", () => {
  it("tracks what is left, starting from earlier spend", () => {
    const budget = new RunBudget(10, 4);
    expect(budget.remaining()).toBe(6);
    budget.add(2.5);
    expect(budget.spent).toBe(6.5);
    expect(budget.remaining()).toBe(3.5);
    expect(budget.exhausted()).toBe(false);
  });

  it("is exhausted at the cap and never reports a negative balance", () => {
    const budget = new RunBudget(1);
    budget.add(1.5);
    expect(budget.exhausted()).toBe(true);
    expect(budget.remaining()).toBe(0);
  });

  it("ignores negative and non-finite costs", () => {
    const budget = new RunBudget(1);
    budget.add(-5);
    budget.add(Number.NaN);
    budget.add(Number.POSITIVE_INFINITY);
    expect(budget.spent).toBe(0);
  });
});
