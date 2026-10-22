import type { AgentAdapter, AgentTurnRequest, AgentTurnResult } from "../agents/adapter.js";
import { type CheckResult, failedChecks, runChecks } from "../checks/run-checks.js";
import type { OrcConfig } from "../config/types.js";
import { OrcError } from "../core/errors.js";
import { changedFiles } from "../git/changes.js";
import { commitAll, createCheckpoint, type WorktreeRef } from "../git/checkpoints.js";
import type { Env } from "../git/git.js";
import type { WorkstreamWorktree } from "../git/worktrees.js";
import { appendDecision, type Decision } from "../vault/decisions.js";
import type { VaultPaths } from "../vault/layout.js";
import { readLogTail } from "../vault/log.js";
import { markTaskDone, type PlanTask, type Workstream } from "../vault/plan.js";
import { roundUsd } from "../vault/session-note.js";
import type { TaskBoard } from "./board.js";
import type { RunBudget } from "./budget.js";
import type { SessionContext } from "./context.js";
import {
  continuePrompt,
  defaultDecisionPrompt,
  driverPrompt,
  driverRepairPrompt,
  firstTaskPrompt,
  fixPrompt,
  nextTaskPrompt,
  plainFixInstruction,
} from "./prompts.js";
import type { SessionRecorder } from "./recorder.js";
import { type DriverDecision, parseDriverReply } from "./reply.js";

/** The driver sees this many LOG lines (Spec: "last 30 LOG lines"). */
export const DRIVER_LOG_LINES = 30;

export type SessionEnd = "done" | "paused" | "stopped";

export interface SessionOutcome {
  readonly session: string;
  readonly end: SessionEnd;
  /** Why it paused or stopped; null when done. */
  readonly reason: string | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly costUsd: number;
}

export interface SessionDeps {
  readonly adapter: AgentAdapter;
  readonly config: OrcConfig;
  readonly vault: VaultPaths;
  readonly worktree: WorkstreamWorktree;
  /** The main checkout, where project-level agent config lives. */
  readonly repoRoot: string;
  readonly workstream: Workstream;
  readonly context: SessionContext;
  readonly recorder: SessionRecorder;
  readonly budget: RunBudget;
  readonly board: TaskBoard;
  /** Contents of kit/prompts/driver.md. */
  readonly driverSystemPrompt: string;
  readonly env: Env;
  readonly now: () => Date;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress: (message: string) => void;
}

interface Halt {
  readonly end: "paused" | "stopped";
  readonly reason: string;
}

/** What the driver decided, or why it could not. */
type DriverVerdict =
  | { readonly kind: "decision"; readonly decision: DriverDecision }
  | { readonly kind: "none" }
  | { readonly kind: "budget" };

/**
 * One workstream's loop: for each task, checkpoint → coding turn → deterministic checks →
 * next task (no model call) | fix prompt from the driver | escalate. Resolves with how the
 * session ended; only unexpected bugs reject.
 */
export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  return new SessionRunner(deps).run();
}

class SessionRunner {
  private readonly worktreeRef: WorktreeRef;
  /** The note already had an agent session: a restarted run, whose first cost delta may recount. */
  private readonly resumedFromNote: boolean;
  private firstTurnDone = false;
  private lastSummary = "";
  private lastDenied: readonly string[] = [];

  constructor(private readonly d: SessionDeps) {
    this.worktreeRef = { path: d.worktree.path, env: d.env };
    this.resumedFromNote = d.recorder.state.agentSession !== null;
  }

  private get rec(): SessionRecorder {
    return this.d.recorder;
  }

  private get aborted(): boolean {
    return this.d.signal?.aborted === true;
  }

  async run(): Promise<SessionOutcome> {
    let previous: PlanTask | null = null;
    for (const task of this.d.workstream.tasks) {
      if (this.d.board.isDone(task.ref)) {
        continue; // finished in an earlier run: the next prompt is a restart, not "T1 passed"
      }
      const halt = await this.runTask(task, previous);
      if (halt !== null) {
        return this.finish(halt.end, halt.reason);
      }
      previous = task;
    }
    return this.finish("done", null);
  }

  private async finish(end: SessionEnd, reason: string | null): Promise<SessionOutcome> {
    const state = this.rec.state;
    await this.rec.update({
      status: end,
      currentTask: end === "done" ? null : state.currentTask,
    });
    const text =
      end === "done"
        ? `all ${state.tasksTotal} tasks done`
        : `${end}${reason === null ? "" : `: ${reason}`}`;
    await this.rec.log(text);
    this.d.onProgress(`[${state.session}] ${text}`);
    return {
      session: state.session,
      end,
      reason,
      tasksDone: this.rec.state.tasksDone,
      tasksTotal: state.tasksTotal,
      costUsd: this.rec.state.costUsd,
    };
  }

  // ---------------------------------------------------------------------------
  // One task

  private async runTask(task: PlanTask, previous: PlanTask | null): Promise<Halt | null> {
    const { workstream, board } = this.d;
    const label = `${task.id} ${task.title}`;
    await this.rec.update({ status: "pending", currentTask: label, checks: [] });

    if (task.needs.some((ref) => !board.isDone(ref))) {
      this.progress(
        `${task.id} waits for ${task.needs.filter((r) => !board.isDone(r)).join(", ")}`,
      );
    }
    const blocked = await board.waitFor(task.needs);
    if (this.aborted) {
      return this.stopped();
    }
    if (blocked !== null) {
      const reason = `${task.id} needs ${blocked.missing.join(", ")}, but that workstream stopped before finishing it`;
      await this.escalate(`${reason}. Unblock it, then run orc run again.`, null, false);
      return this.pause(reason);
    }
    if (this.d.budget.exhausted()) {
      return this.pauseForBudget(label);
    }

    const { checkpoint, savedWork } = await createCheckpoint(this.worktreeRef, {
      workstream: workstream.name,
      task: task.id,
    });
    await this.rec.log(
      `checkpoint ${checkpoint.id} before ${task.id}${savedWork ? " (saved pending work)" : ""}`,
    );

    let prompt =
      this.rec.state.agentSession === null
        ? firstTaskPrompt({
            workstream,
            task,
            context: this.d.context,
            checks: this.d.config.checks,
            vaultPath: this.d.vault.root,
          })
        : nextTaskPrompt(task, previous);
    let fixes = 0;
    let turns = 0;

    for (;;) {
      if (this.aborted) {
        return this.stopped();
      }
      if (this.d.budget.exhausted()) {
        return this.pauseForBudget(label);
      }
      await this.rec.update({ status: "running", currentTask: label });
      this.progress(`${task.id} turn ${turns + 1}`);
      const turn = await this.codingTurn(prompt);
      turns += 1;
      if (this.aborted) {
        return this.stopped();
      }

      if (turn.outcome === "max_budget") {
        await this.logTurn(task, turns, turn, []);
        return this.pauseForBudget(label);
      }
      if (turn.outcome === "refused") {
        await this.logTurn(task, turns, turn, []);
        const reason = `the agent refused ${task.id}`;
        await this.escalate(`${reason}. ${turn.errors.join("; ")}`.trim(), null, false);
        return this.pause(reason);
      }

      let results: CheckResult[] = [];
      let problem: string | null = null;
      if (turn.outcome === "success") {
        this.lastSummary = turn.text;
        results = await this.runGate();
        if (this.aborted) {
          return this.stopped();
        }
        await this.logTurn(task, turns, turn, results);
        if (failedChecks(results).length === 0) {
          await this.complete(task);
          return null;
        }
      } else {
        problem = `${turn.outcome}${turn.errors.length === 0 ? "" : `: ${turn.errors.join("; ")}`}`;
        await this.logTurn(task, turns, turn, []);
      }

      const failure =
        problem ??
        `checks failed: ${failedChecks(results)
          .map((r) => r.name)
          .join(", ")}`;
      if (fixes >= this.d.config.retries.maxPerTask) {
        const reason = `${task.id} still failing after ${fixes} fix attempt${fixes === 1 ? "" : "s"} (${failure})`;
        await this.escalate(
          `${reason}. Look at the worktree (${this.d.worktree.path}) and tell the session what to do.`,
          null,
          false,
        );
        return this.pause(reason);
      }
      await this.rec.note(
        "Problems",
        `${task.id}: ${failure} (retry ${fixes + 1}/${this.d.config.retries.maxPerTask})`,
      );
      fixes += 1;

      if (problem !== null) {
        prompt = continuePrompt(turn.outcome, turn.errors, task);
        continue;
      }
      const next = await this.decideFix(task, results, fixes - 1);
      if ("halt" in next) {
        return next.halt;
      }
      prompt = next.prompt;
    }
  }

  private async complete(task: PlanTask): Promise<void> {
    const { workstream, board, vault } = this.d;
    const files = await changedFiles(this.worktreeRef);
    const commit = await commitAll(
      this.worktreeRef,
      `orc(${workstream.name}): ${task.id} ${task.title}`,
    );
    await markTaskDone(vault, workstream.name, task.id);
    board.markDone(task.ref);
    await this.rec.update({ tasksDone: this.rec.state.tasksDone + 1, status: "running" });
    await this.rec.note("Progress", `${task.id} done: ${task.title}`);
    await this.rec.log(
      `${task.id} done: ${task.title}${commit === null ? "" : ` (commit ${commit.slice(0, 7)})`}`,
      files,
    );
    this.progress(`${task.id} done`);
  }

  // ---------------------------------------------------------------------------
  // Turns

  private async codingTurn(prompt: string): Promise<AgentTurnResult> {
    const { config, budget } = this.d;
    const state = this.rec.state;
    const result = await this.runTurn({
      prompt,
      cwd: this.d.worktree.path,
      model: config.coder.model,
      resumeSessionId: state.agentSession ?? undefined,
      access: "edit",
      allowedCommands: config.checks.map((check) => check.command),
      projectRoot: this.d.repoRoot,
      maxBudgetUsd: budget.remaining(),
      signal: this.d.signal,
    });
    budget.add(result.costUsd);
    const recount = this.resumedFromNote && !this.firstTurnDone && result.costUsd > 0;
    this.firstTurnDone = true;
    this.lastDenied = result.deniedActions;
    await this.rec.update({
      costUsd: state.costUsd + result.costUsd,
      agentSession: result.sessionId === "" ? state.agentSession : result.sessionId,
      ...(recount ? { costMayBeOvercounted: true } : {}),
    });
    return result;
  }

  /** A backend that cannot run at all becomes an "error" turn; anything else is a bug and propagates. */
  private async runTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    try {
      return await this.d.adapter.runTurn(request);
    } catch (error) {
      if (error instanceof OrcError && error.code === "AGENT_FAILED") {
        return {
          sessionId: request.resumeSessionId ?? "",
          outcome: "error",
          text: "",
          costUsd: 0,
          durationMs: 0,
          errors: [error.message, ...error.details.slice(-3)],
          deniedActions: [],
        };
      }
      throw error;
    }
  }

  private async runGate(): Promise<CheckResult[]> {
    const { config } = this.d;
    await this.rec.update({
      status: "checking",
      checks: config.checks.map((check) => ({ name: check.name, status: "pending" })),
    });
    const results = await runChecks(config.checks, {
      cwd: this.d.worktree.path,
      env: this.d.env,
      signal: this.d.signal,
      now: this.d.now,
    });
    const byName = new Map(results.map((result) => [result.name, result.status]));
    await this.rec.update({
      checks: config.checks.map((check) => ({
        name: check.name,
        status: byName.get(check.name) ?? "skipped",
      })),
    });
    return results;
  }

  private async logTurn(
    task: PlanTask,
    turns: number,
    turn: AgentTurnResult,
    results: readonly CheckResult[],
  ): Promise<void> {
    const failed = failedChecks(results).map((result) => result.name);
    const checks =
      turn.outcome !== "success" || results.length === 0
        ? ""
        : failed.length === 0
          ? ", checks pass"
          : `, checks fail: ${failed.join(" ")}`;
    const files = await changedFiles(this.worktreeRef);
    await this.rec.log(
      `${task.id} turn ${turns}: ${turn.outcome}${checks} (~$${roundUsd(turn.costUsd)})`,
      files,
    );
  }

  // ---------------------------------------------------------------------------
  // The driver: a fix prompt or an escalation after a failed check

  private async decideFix(
    task: PlanTask,
    results: readonly CheckResult[],
    attempt: number,
  ): Promise<{ readonly prompt: string } | { readonly halt: Halt }> {
    const verdict = await this.askDriver(task, results, attempt);
    if (verdict.kind === "budget") {
      return { halt: await this.pauseForBudget(`${task.id} ${task.title}`) };
    }
    if (verdict.kind === "none") {
      await this.rec.log(`driver gave no usable reply for ${task.id}; sent a plain fix prompt`);
      return { prompt: fixPrompt(plainFixInstruction(task), results, this.lastDenied) };
    }
    const decision = verdict.decision;
    if (decision.action === "fix") {
      return { prompt: fixPrompt(decision.prompt, results, this.lastDenied) };
    }

    const recorded = await this.escalate(
      decision.question,
      decision.defaultTaken,
      decision.reversible,
    );
    if (decision.reversible && decision.defaultTaken !== null) {
      await this.rec.log(`took the reversible default for ${recorded.id} and carried on`);
      return {
        prompt: defaultDecisionPrompt(
          decision.question,
          decision.defaultTaken,
          recorded.id,
          results,
        ),
      };
    }
    return { halt: await this.pause(`${recorded.id}: ${decision.question}`) };
  }

  /** One driver call (plus repair turns for unusable replies) on the small driver model. */
  private async askDriver(
    task: PlanTask,
    results: readonly CheckResult[],
    attempt: number,
  ): Promise<DriverVerdict> {
    const { config, budget, vault, workstream } = this.d;
    const logTail = await readLogTail(vault, DRIVER_LOG_LINES);
    let prompt = driverPrompt({
      workstream,
      task,
      context: this.d.context,
      logTail,
      lastSummary: this.lastSummary,
      results,
      deniedActions: this.lastDenied,
      attempt,
      maxAttempts: config.retries.maxPerTask,
    });
    let resume: string | undefined;

    for (let repairs = 0; ; repairs += 1) {
      if (budget.exhausted()) {
        return { kind: "budget" };
      }
      const reply = await this.runTurn({
        prompt,
        cwd: this.d.worktree.path,
        model: config.driver.model,
        systemPrompt: this.d.driverSystemPrompt,
        resumeSessionId: resume,
        access: "read-only",
        projectRoot: this.d.repoRoot,
        maxBudgetUsd: budget.remaining(),
        signal: this.d.signal,
      });
      budget.add(reply.costUsd);
      await this.rec.addCost(reply.costUsd);
      if (reply.outcome === "max_budget") {
        return { kind: "budget" };
      }
      if (reply.outcome !== "success") {
        return { kind: "none" };
      }
      const parsed = parseDriverReply(reply.text);
      if (parsed.ok) {
        return { kind: "decision", decision: parsed.value };
      }
      if (repairs >= config.retries.maxPerTask || this.aborted) {
        return { kind: "none" };
      }
      resume = reply.sessionId;
      prompt = driverRepairPrompt(parsed.issues);
    }
  }

  // ---------------------------------------------------------------------------
  // Pausing and escalating

  private async escalate(
    question: string,
    defaultTaken: string | null,
    reversible: boolean,
  ): Promise<Decision> {
    const decision = await appendDecision(this.d.vault, {
      session: this.rec.state.session,
      question,
      defaultTaken,
      reversible,
      now: this.d.now(),
    });
    await this.rec.note(
      "Decisions",
      `${decision.id}: ${question}${defaultTaken === null ? "" : ` Default: ${defaultTaken}`}`,
    );
    await this.rec.log(`escalated ${decision.id}: ${question}`);
    return decision;
  }

  private async pause(reason: string): Promise<Halt> {
    await this.rec.note("Problems", `paused: ${reason}`);
    return { end: "paused", reason };
  }

  private async pauseForBudget(label: string): Promise<Halt> {
    const { budget } = this.d;
    const reason = `run cap of $${budget.capUsd} reached (about $${roundUsd(budget.spent)} spent) at ${label}`;
    const decision = await this.escalate(
      `${reason}. Raise maxBudgetUsd in orc.config.json, then run orc run again to resume.`,
      null,
      false,
    );
    return this.pause(`${reason} (${decision.id})`);
  }

  private stopped(): Halt {
    return { end: "stopped", reason: "stopped by the user" };
  }

  private progress(message: string): void {
    this.d.onProgress(`[${this.rec.state.session}] ${message}`);
  }
}
