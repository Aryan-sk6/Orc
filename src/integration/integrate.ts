import { type CheckResult, failedChecks, runCheck, runChecks } from "../checks/run-checks.js";
import { DEFAULT_CHECK_TIMEOUT_MS } from "../config/defaults.js";
import type { OrcConfig } from "../config/types.js";
import { SessionRecorder } from "../driver/recorder.js";
import type { Env } from "../git/git.js";
import { git } from "../git/git.js";
import {
  ensureIntegrationWorktree,
  type IntegrationWorktree,
  integrationBranch,
  mergeBranch,
} from "../git/integration.js";
import { defaultWorktreesDir, type Repo, workstreamBranch } from "../git/worktrees.js";
import { appendDecision, type Decision } from "../vault/decisions.js";
import type { VaultPaths } from "../vault/layout.js";
import { formatTimestamp } from "../vault/log.js";
import type { Plan, Workstream } from "../vault/plan.js";

/** Session name of the integration driver: its note is vault/sessions/integration.md. */
export const INTEGRATION_SESSION = "integration";

/** Failing output kept in the session note per command. */
const NOTE_OUTPUT_CHARS = 1500;

export interface IntegrateOptions {
  readonly config: OrcConfig;
  readonly vault: VaultPaths;
  readonly repo: Repo;
  readonly plan: Plan;
  /** Names the branch orc-integration/<milestone>. */
  readonly milestone: string;
  readonly env: Env;
  readonly now: () => Date;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((message: string) => void) | undefined;
}

export type MergeStatus =
  | { readonly kind: "merged"; readonly commit: string }
  | { readonly kind: "already-merged" }
  | { readonly kind: "conflict"; readonly files: readonly string[] }
  | { readonly kind: "skipped"; readonly reason: string };

export interface WorkstreamMerge {
  readonly workstream: string;
  readonly status: MergeStatus;
}

export type IntegrationEnd = "done" | "paused" | "stopped";

export interface IntegrationResult {
  readonly milestone: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly merges: readonly WorkstreamMerge[];
  /** Install result (when `installCommand` is set); null if it was not run. */
  readonly install: CheckResult | null;
  /** Check results; null if the checks were not run. */
  readonly checks: readonly CheckResult[] | null;
  readonly end: IntegrationEnd;
  readonly reason: string | null;
}

/**
 * `orc integrate`: merges every finished workstream branch into orc-integration/<milestone>
 * (a worktree of its own) and runs the full check suite there. Deterministic: no model call.
 * Conflicts and failing checks become decisions for the user; nothing is resolved automatically
 * because workstreams own disjoint files by design. Safe to run again after fixing the cause.
 */
export async function runIntegration(options: IntegrateOptions): Promise<IntegrationResult> {
  return new IntegrationRunner(options).run();
}

class IntegrationRunner {
  private readonly progress: (message: string) => void;
  private readonly recorder: SessionRecorder;

  constructor(private readonly o: IntegrateOptions) {
    this.progress = o.onProgress ?? (() => undefined);
    const order = mergeOrder(o.plan.workstreams);
    this.recorder = new SessionRecorder(
      o.vault,
      {
        session: INTEGRATION_SESSION,
        workstream: INTEGRATION_SESSION,
        branch: integrationBranch(o.milestone),
        status: "running",
        currentTask: null,
        tasksDone: 0,
        tasksTotal: order.length,
        checks: [],
        costUsd: 0,
        agentSession: null,
        costMayBeOvercounted: false,
        updated: formatTimestamp(o.now()),
      },
      o.now,
    );
  }

  async run(): Promise<IntegrationResult> {
    const { o } = this;
    const { worktree } = await ensureIntegrationWorktree(o.repo, {
      milestone: o.milestone,
      worktreesDir: defaultWorktreesDir(o.repo.root),
    });
    const order = mergeOrder(o.plan.workstreams);
    await this.recorder.update({});
    await this.recorder.log(
      `integrating ${order.map((ws) => ws.name).join(", ")} into ${worktree.branch}`,
    );

    const merges = await this.mergeAll(worktree, order);
    if (merges === "stopped") {
      return this.finish(worktree, [], null, null, "stopped", "stopped by the user");
    }
    const integrated = merges.filter(
      (m) => m.status.kind === "merged" || m.status.kind === "already-merged",
    );
    const blocked = merges.filter(
      (m) => m.status.kind === "conflict" || m.status.kind === "skipped",
    );
    await this.recorder.update({ tasksDone: integrated.length });

    const notMerged =
      blocked.length === 0
        ? null
        : `${blocked.length} of ${order.length} workstreams not merged: ${blocked.map((m) => m.workstream).join(", ")}`;
    if (integrated.length === 0) {
      const allFinished = o.plan.workstreams.every((ws) => ws.tasks.every((task) => task.done));
      if (allFinished && !blocked.some((m) => m.status.kind === "conflict")) {
        // Everything is finished yet nothing merged (a conflict would already be escalated):
        // that is stuck for a reason a person has to look at, not just work still to do.
        await this.escalate(
          `orc integrate merged nothing although every workstream is finished: ${notMerged}.`,
        );
      }
      return this.finish(worktree, merges, null, null, "paused", notMerged ?? "nothing to merge");
    }

    const install = await this.install(worktree);
    if (install !== null && install.status === "fail") {
      const reason = install.aborted
        ? "stopped by the user"
        : `the install command failed (${install.command})`;
      if (install.aborted) {
        return this.finish(worktree, merges, install, null, "stopped", reason);
      }
      await this.escalate(
        `${reason} in ${worktree.path}. Fix installCommand in orc.config.json, then run orc integrate again.`,
      );
      await this.recorder.note("Problems", `${reason}: ${tailOf(install.output)}`);
      return this.finish(worktree, merges, install, null, "paused", reason);
    }

    const checks = await this.runGate(worktree);
    if (o.signal?.aborted === true) {
      return this.finish(worktree, merges, install, checks, "stopped", "stopped by the user");
    }
    const failed = failedChecks(checks).map((c) => c.name);
    if (failed.length > 0) {
      const reason = `checks failed on ${worktree.branch}: ${failed.join(", ")}`;
      const decision = await this.escalate(
        `${reason}. Look at ${worktree.path}; fix it there or in a workstream, then run orc integrate again.`,
      );
      for (const result of failedChecks(checks)) {
        await this.recorder.note("Problems", `${result.name} failed: ${tailOf(result.output)}`);
      }
      return this.finish(worktree, merges, install, checks, "paused", `${reason} (${decision.id})`);
    }
    if (notMerged !== null) {
      return this.finish(worktree, merges, install, checks, "paused", notMerged);
    }
    return this.finish(worktree, merges, install, checks, "done", null);
  }

  // ---------------------------------------------------------------------------

  private async mergeAll(
    worktree: IntegrationWorktree,
    order: readonly Workstream[],
  ): Promise<WorkstreamMerge[] | "stopped"> {
    const { o } = this;
    const results = new Map<string, MergeStatus>();
    const integrated = (name: string): boolean => {
      const kind = results.get(name)?.kind;
      return kind === "merged" || kind === "already-merged";
    };

    for (const workstream of order) {
      if (o.signal?.aborted === true) {
        return "stopped";
      }
      const status = await this.mergeOne(worktree, workstream, integrated);
      results.set(workstream.name, status);
      await this.recorder.update({ currentTask: `merge ${workstream.name}` });
      this.progress(`[integration] ${workstream.name}: ${describeMerge(status)}`);
      await this.recorder.log(`${workstream.name}: ${describeMerge(status)}`);
      if (status.kind === "conflict") {
        await this.escalate(
          `merging ${workstreamBranch(workstream.name)} into ${worktree.branch} conflicts in ${status.files.join(", ")}. ` +
            `Workstreams should own disjoint files. Resolve it by hand in ${worktree.path} ` +
            `(git merge ${workstreamBranch(workstream.name)}), commit, then run orc integrate again.`,
        );
      }
    }
    return order.map((workstream) => ({
      workstream: workstream.name,
      status: results.get(workstream.name) ?? { kind: "skipped", reason: "not reached" },
    }));
  }

  private async mergeOne(
    worktree: IntegrationWorktree,
    workstream: Workstream,
    integrated: (name: string) => boolean,
  ): Promise<MergeStatus> {
    const { o } = this;
    const done = workstream.tasks.filter((task) => task.done).length;
    if (done < workstream.tasks.length) {
      return { kind: "skipped", reason: `unfinished (${done}/${workstream.tasks.length} tasks)` };
    }
    // Workstreams that depend on each other (task-level needs in both directions) can't be ordered:
    // merge them together once all of them are finished.
    const mates = dependencyCycleMates(o.plan.workstreams, workstream.name);
    const missing = workstream.dependsOn.filter((name) => {
      if (integrated(name)) {
        return false;
      }
      const mate = mates.get(name);
      return mate === undefined || mate.tasks.some((task) => !task.done);
    });
    if (missing.length > 0) {
      return { kind: "skipped", reason: `depends on ${missing.join(", ")}, which is not merged` };
    }
    const branch = workstreamBranch(workstream.name);
    const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: o.repo.root,
      env: o.env,
      okExitCodes: [1],
    });
    if (exists.exitCode !== 0) {
      return { kind: "skipped", reason: `branch ${branch} does not exist (run orc run first)` };
    }
    const result = await mergeBranch(
      { path: worktree.path, env: o.env },
      branch,
      `orc(integration): merge ${branch}`,
    );
    if (result.kind === "merged") {
      return { kind: "merged", commit: result.commit };
    }
    return result.kind === "up-to-date" ? { kind: "already-merged" } : result;
  }

  private async install(worktree: IntegrationWorktree): Promise<CheckResult | null> {
    const { o } = this;
    if (o.config.installCommand.trim() === "") {
      return null;
    }
    this.progress(`[integration] installing: ${o.config.installCommand}`);
    await this.recorder.update({ status: "checking", currentTask: "install" });
    const result = await runCheck(
      { name: "install", command: o.config.installCommand, timeoutMs: DEFAULT_CHECK_TIMEOUT_MS },
      { cwd: worktree.path, env: o.env, signal: o.signal, now: o.now },
    );
    await this.recorder.log(`install ${result.status}`);
    return result;
  }

  private async runGate(worktree: IntegrationWorktree): Promise<CheckResult[]> {
    const { o } = this;
    this.progress(`[integration] running ${o.config.checks.length} checks on ${worktree.branch}`);
    await this.recorder.update({
      status: "checking",
      currentTask: "checks",
      checks: o.config.checks.map((check) => ({ name: check.name, status: "pending" })),
    });
    const results = await runChecks(o.config.checks, {
      cwd: worktree.path,
      env: o.env,
      signal: o.signal,
      now: o.now,
    });
    const byName = new Map(results.map((result) => [result.name, result.status]));
    await this.recorder.update({
      checks: o.config.checks.map((check) => ({
        name: check.name,
        status: byName.get(check.name) ?? "skipped",
      })),
    });
    return results;
  }

  private async escalate(question: string): Promise<Decision> {
    const decision = await appendDecision(this.o.vault, {
      session: INTEGRATION_SESSION,
      question,
      defaultTaken: null,
      reversible: false,
      now: this.o.now(),
    });
    await this.recorder.note("Decisions", `${decision.id}: ${question}`);
    await this.recorder.log(`escalated ${decision.id}: ${question}`);
    return decision;
  }

  private async finish(
    worktree: IntegrationWorktree,
    merges: readonly WorkstreamMerge[],
    install: CheckResult | null,
    checks: readonly CheckResult[] | null,
    end: IntegrationEnd,
    reason: string | null,
  ): Promise<IntegrationResult> {
    await this.recorder.update({
      status: end,
      currentTask: end === "done" ? null : this.recorder.state.currentTask,
    });
    const text =
      end === "done"
        ? `all ${merges.length} workstreams merged into ${worktree.branch}, checks pass`
        : `${end}${reason === null ? "" : `: ${reason}`}`;
    await this.recorder.log(text);
    if (end === "done") {
      await this.recorder.note("Progress", text);
    }
    this.progress(`[integration] ${text}`);
    return {
      milestone: worktree.milestone,
      branch: worktree.branch,
      worktreePath: worktree.path,
      merges,
      install,
      checks,
      end,
      reason,
    };
  }
}

/** Workstreams with the ones they depend on first; otherwise the plan's (alphabetical) order. */
export function mergeOrder(workstreams: readonly Workstream[]): Workstream[] {
  const byName = new Map(workstreams.map((ws) => [ws.name, ws]));
  const ordered: Workstream[] = [];
  const seen = new Set<string>();
  const visit = (workstream: Workstream): void => {
    if (seen.has(workstream.name)) {
      return;
    }
    seen.add(workstream.name);
    for (const name of workstream.dependsOn) {
      const dependency = byName.get(name);
      if (dependency !== undefined) {
        visit(dependency);
      }
    }
    ordered.push(workstream);
  };
  workstreams.forEach(visit);
  return ordered;
}

/** Workstreams in a dependency cycle with `name` (reachable from it and reaching it), by name. */
function dependencyCycleMates(
  workstreams: readonly Workstream[],
  name: string,
): Map<string, Workstream> {
  const byName = new Map(workstreams.map((ws) => [ws.name, ws]));
  const reachable = (from: string): Set<string> => {
    const found = new Set<string>();
    const stack = [from];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      for (const dependency of byName.get(next)?.dependsOn ?? []) {
        if (!found.has(dependency)) {
          found.add(dependency);
          stack.push(dependency);
        }
      }
    }
    return found;
  };
  const mates = new Map<string, Workstream>();
  for (const other of reachable(name)) {
    const workstream = byName.get(other);
    if (workstream !== undefined && reachable(other).has(name)) {
      mates.set(other, workstream);
    }
  }
  return mates;
}

export function describeMerge(status: MergeStatus): string {
  switch (status.kind) {
    case "merged":
      return `merged (${status.commit.slice(0, 7)})`;
    case "already-merged":
      return "already merged";
    case "conflict":
      return `CONFLICT in ${status.files.join(", ")}`;
    case "skipped":
      return `skipped: ${status.reason}`;
  }
}

function tailOf(output: string): string {
  const trimmed = output.trim();
  return trimmed.length <= NOTE_OUTPUT_CHARS ? trimmed : `…${trimmed.slice(-NOTE_OUTPUT_CHARS)}`;
}
