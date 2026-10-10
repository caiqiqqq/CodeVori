import { Emitter } from "@zcode/rpc";
import {
  delegationFollowUpSchema,
  delegationParentSchema,
  delegationSettingsSchema,
  delegationTargetSchema,
  delegationResultSchema,
  delegationRedeliverSchema,
  uuidv7,
  type DelegationCreate,
  type DelegationParent,
  type DelegationTarget,
  type DelegationTask,
  type DelegationFollowUp,
  type DelegationSettings,
  type WorkTaskScope,
  type DelegationRedeliver,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IAgentDelegationService, DelegationDependencies } from "./contract.js";
import { DelegationRepository, parentKey } from "./delegationRepository.js";
import { claimDelegations, deliverDelegationResults } from "./delegationScheduler.js";
import { executeDelegationAttempt } from "./delegationAttempt.js";
import { admitDelegation, findDelegationBinding } from "./delegationAdmission.js";
import { listDelegationTargets } from "./delegationTargets.js";

const active = new Set(["preparing", "running", "awaiting_input"]);
const terminal = new Set(["completed", "failed", "interrupted", "canceled"]);
const logger = createServiceLogger("agent-delegation");

export class AgentDelegationService implements IAgentDelegationService {
  private readonly repo: DelegationRepository;
  private readonly owner = uuidv7();
  private readonly emitter = new Emitter<void>();
  private readonly runs = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private delivering?: Promise<void>;
  private lastProjection = "";
  private disposed = false;
  private disposing?: Promise<void>;
  constructor(private readonly deps: DelegationDependencies) {
    this.repo = new DelegationRepository(deps.path);
  }
  async targets() {
    return listDelegationTargets(this.deps);
  }
  async list(input: DelegationParent) {
    await this.repo.open();
    return this.repo.list(delegationParentSchema.parse(input));
  }
  onDynamicChanged(_parent: DelegationParent) {
    return this.emitter.event;
  }
  async getSettings(scope: WorkTaskScope) {
    await this.repo.open();
    return this.repo.settings(scope);
  }
  async updateSettings(input: WorkTaskScope & DelegationSettings) {
    await this.repo.open();
    this.repo.transaction(() => {
      const current = this.repo.settings(input);
      this.repo.setSettings(
        input,
        delegationSettingsSchema.parse({
          // 旧客户端缺少新字段时保留当前值，避免修改层级又意外开启委托或重置缓存预算。
          enabled: input.enabled === undefined ? current.enabled : input.enabled,
          completedCacheMaxMb:
            input.completedCacheMaxMb === undefined
              ? current.completedCacheMaxMb
              : input.completedCacheMaxMb,
          concurrency: input.concurrency,
          allowNested: input.allowNested,
          maxDepth: input.maxDepth,
        }),
      );
    });
    this.emitter.fire();
  }
  async binding(parent: DelegationParent, requestId?: string) {
    await this.repo.open();
    return findDelegationBinding(this.repo, parent, requestId);
  }
  async armParent(parent: DelegationParent) {
    await this.repo.open();
    this.repo.transaction(() => {
      const state = this.repo.parent(parent);
      this.repo.setParent(parent, { ...state, suspended: false });
    });
  }
  async pauseParent(parent: DelegationParent) {
    await this.repo.open();
    this.repo.transaction(() => {
      const state = this.repo.parent(parent);
      this.repo.setParent(parent, { generation: state.generation + 1, suspended: true });
      for (const task of this.repo.list()) {
        if (
          parentKey(task.rootParent) !== parentKey(parent) &&
          parentKey(task.parent) !== parentKey(parent)
        )
          continue;
        if (!terminal.has(task.status)) this.cancelTask(task);
        else {
          for (const attempt of task.attempts)
            if (attempt.delivery !== "delivered") attempt.delivery = "suppressed";
          this.repo.put(task);
        }
      }
    });
    this.abortCanceled();
    this.emitter.fire();
  }
  async hasPendingChildren(parent: DelegationParent): Promise<boolean> {
    await this.repo.open();
    const key = parentKey(delegationParentSchema.parse(parent));
    return this.repo
      .list()
      .some(
        (task) =>
          (parentKey(task.parent) === key || parentKey(task.rootParent) === key) &&
          !terminal.has(task.status),
      );
  }
  async delegate(raw: DelegationCreate) {
    if (this.disposed) throw new Error("delegation.closed");
    const task = await admitDelegation(this.repo, this.deps, raw);
    this.emitter.fire();
    return task;
  }
  private scoped(input: DelegationTarget) {
    const task = this.repo.get(input.id);
    if (!task || parentKey(task.parent) !== parentKey(input))
      throw new Error("delegation.not-found");
    return task;
  }
  async followUp(raw: DelegationFollowUp) {
    const input = delegationFollowUpSchema.parse(raw);
    if (this.disposed) throw new Error("delegation.closed");
    await this.repo.open();
    const old = this.scoped(input);
    const task = await admitDelegation(
      this.repo,
      this.deps,
      {
        ...old.parent,
        requestId: input.requestId,
        title: old.title,
        task: input.task,
        background: old.background,
        constraints: old.constraints,
        expectedResult: old.expectedResult,
        execution: old.execution,
        intent: old.intent,
        dependsOn: [],
        workspaceFiles: input.workspaceFiles ?? old.workspaceFiles,
        attachments: input.attachments ?? old.attachments,
      },
      old.id,
    );
    this.emitter.fire();
    return task;
  }
  private async restart(raw: DelegationTarget, resume: boolean) {
    const input = delegationTargetSchema.parse(raw);
    await this.repo.open();
    return this.repo.transaction(() => {
      const task = this.scoped(input);
      if (!this.repo.settings(task.rootParent).enabled) throw new Error("delegation.disabled");
      if (resume ? task.status !== "interrupted" : task.status !== "failed")
        throw new Error(resume ? "delegation.not-resumable" : "delegation.not-retryable");
      const state = this.repo.parent(task.rootParent);
      if (state.suspended) throw new Error("delegation.parent-stopped");
      if (!resume) {
        delete task.session;
        task.sessionRequestId = uuidv7();
      }
      task.generation = state.generation;
      task.status = "queued";
      task.updatedAt = Date.now();
      this.repo.put(task);
      this.emitter.fire();
      return task;
    });
  }
  retry(input: DelegationTarget) {
    return this.restart(input, false);
  }
  resume(input: DelegationTarget) {
    return this.restart(input, true);
  }
  private cancelTask(task: DelegationTask) {
    if (!terminal.has(task.status)) {
      task.status = "canceled";
      task.updatedAt = Date.now();
      const attempt = task.attempts.at(-1);
      if (attempt && !attempt.endedAt) {
        attempt.status = "canceled";
        attempt.endedAt = task.updatedAt;
      }
    }
    for (const item of task.attempts)
      if (item.delivery !== "delivered") item.delivery = "suppressed";
    delete task.owner;
    delete task.leaseUntil;
    this.repo.put(task);
    if (task.session) {
      const childParent = {
        ...task.parent,
        workspacePath: task.worktree?.path ?? task.parent.workspacePath,
        kind: task.session.kind,
        sessionId: task.session.id,
      };
      // 已完成的下级也可能有待回传结果；取消树不能只遍历正在执行的节点。
      const state = this.repo.parent(childParent);
      this.repo.setParent(childParent, { generation: state.generation + 1, suspended: true });
      for (const child of this.repo.list(childParent)) this.cancelTask(child);
    }
  }
  private abortCanceled() {
    for (const [id, run] of this.runs)
      if (this.repo.get(id)?.status === "canceled") run.abort.abort();
  }
  async cancel(raw: DelegationTarget) {
    const input = delegationTargetSchema.parse(raw);
    await this.repo.open();
    this.repo.transaction(() => {
      const task = this.scoped(input);
      this.cancelTask(task);
    });
    this.abortCanceled();
    this.emitter.fire();
  }
  async cancelAll(input: DelegationParent) {
    const parent = delegationParentSchema.parse(input);
    await this.repo.open();
    this.repo.transaction(() => {
      for (const task of this.repo.list(parent)) this.cancelTask(task);
    });
    this.abortCanceled();
    this.emitter.fire();
  }
  async redeliver(raw: DelegationRedeliver) {
    const input = delegationRedeliverSchema.parse(raw);
    await this.repo.open();
    this.repo.transaction(() => {
      const task = this.scoped(input);
      const attempt = input.attemptSequence
        ? task.attempts.find((item) => item.sequence === input.attemptSequence)
        : task.attempts.at(-1);
      if (!attempt?.endedAt || attempt.delivery === "sending")
        throw new Error("delegation.not-deliverable");
      if (this.repo.parent(task.rootParent).suspended) throw new Error("delegation.parent-stopped");
      task.generation = this.repo.parent(task.rootParent).generation;
      attempt.delivery = "pending";
      attempt.deliveryCommandId = uuidv7();
      this.repo.put(task);
    });
    this.emitter.fire();
  }
  async submitResult(id: string, commandId: string, result: unknown) {
    await this.repo.open();
    const parsed = delegationResultSchema.parse(result);
    this.repo.transaction(() => {
      const task = this.repo.get(id);
      if (
        task?.owner !== this.owner ||
        task.attempts.at(-1)?.commandId !== commandId ||
        (task.leaseUntil ?? 0) <= Date.now() ||
        this.repo.parent(task.rootParent).suspended ||
        task.generation !== this.repo.parent(task.rootParent).generation ||
        !active.has(task.status)
      )
        throw new Error("delegation.stale-attempt");
      task.attempts.at(-1)!.result = parsed;
      this.repo.put(task);
    });
  }
  async beforeParentCommand(parent: DelegationParent, type: string, commandId: string) {
    await this.repo.open();
    if (type === "stop" || type === "deleteSession") return this.pauseParent(parent);
    if (type !== "sendText" && type !== "sendGoalCommand") return;
    const notification = this.repo
      .list(parent)
      .find((t) => t.attempts.some((a) => a.deliveryCommandId === commandId));
    if (!notification) return this.armParent(parent);
    if (
      this.repo.parent(notification.rootParent).suspended ||
      notification.generation !== this.repo.parent(notification.rootParent).generation
    )
      throw new Error("delegation.parent-stopped");
  }
  startScheduler() {
    if (this.timer) return;
    const tick = () => {
      void this.tick().catch((error: unknown) =>
        logger.warn(undefined, "委派调度失败", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    this.timer = setInterval(tick, 500);
    this.timer.unref();
    tick();
  }
  tick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return (this.ticking ??= this.runTick().finally(() => {
      this.ticking = undefined;
    }));
  }
  private async runTick() {
    await this.repo.open();
    if (this.disposed) return;
    const claimed = claimDelegations(this.repo, this.owner, new Set(this.runs.keys()), (task) =>
      this.cancelTask(task),
    );
    for (const task of claimed) {
      const abort = new AbortController();
      const done = executeDelegationAttempt(
        task,
        abort,
        this.repo,
        this.owner,
        this.deps.execute,
        () => this.disposed,
        () => this.emitter.fire(),
      ).finally(() => {
        this.runs.delete(task.id);
      });
      this.runs.set(task.id, { abort, done });
    }
    for (const [id, run] of this.runs)
      if (this.repo.get(id)?.owner !== this.owner) run.abort.abort();
    // 回传 admission 可能等待网络；心跳独立，不能阻塞其它执行的 lease。
    this.delivering ??= deliverDelegationResults(
      this.repo,
      this.owner,
      this.deps.deliver,
      () => this.disposed,
    )
      .catch((error: unknown) =>
        logger.warn(undefined, "委派结果回传失败", {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => {
        this.delivering = undefined;
      });
    const projection = JSON.stringify(
      this.repo.list().map(({ owner: _owner, leaseUntil: _lease, ...task }) => task),
    );
    if (projection !== this.lastProjection) {
      this.lastProjection = projection;
      this.emitter.fire();
    }
  }
  disposeAll() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const run of this.runs.values()) run.abort.abort();
  }
  disposeAllAndWait(): Promise<void> {
    // 多个 Host 收尾入口可能同时触发；只关闭一次，不能在关闭后重新进入事务。
    return (this.disposing ??= this.finishDisposing());
  }
  private async finishDisposing() {
    this.disposeAll();
    await this.ticking;
    await this.delivering;
    await Promise.allSettled([...this.runs.values()].map((r) => r.done));
    await this.repo.open();
    this.repo.transaction(() => {
      for (const task of this.repo.list())
        if (task.owner === this.owner && active.has(task.status)) {
          task.status = "interrupted";
          delete task.owner;
          delete task.leaseUntil;
          const attempt = task.attempts.at(-1)!;
          attempt.status = "interrupted";
          attempt.endedAt = Date.now();
          attempt.delivery = "pending";
          this.repo.put(task);
        }
    });
    this.repo.close();
    this.emitter.dispose();
  }
}
