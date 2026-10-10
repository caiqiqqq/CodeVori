import { WorkTaskEvents } from "./workTaskEvents.js";
import { randomUUID } from "node:crypto";
import { type Event, type IDisposable } from "@zcode/rpc";
import {
  workTaskExecutionPath,
  workTaskMergeRequestSchema,
  isWorkTaskMerging,
  workTaskArchiveSchema,
  workTaskConcurrencySchema,
  workTaskCreateSchema,
  workTaskListSchema,
  workTaskScopeSchema,
  workTaskStartSchema,
  workTaskTargetSchema,
  workTaskCompleteSchema,
  workTaskUpdateSchema,
  workTaskAttachmentImportSchema,
  workTaskAttachmentBeginSchema,
  workTaskAttachmentChunkSchema,
  workTaskAttachmentTargetSchema,
  type WorkTaskAttachment,
  type WorkTaskAttachmentImport,
  type WorkTaskAttachmentBegin,
  type WorkTaskAttachmentChunk,
  type WorkTaskAttachmentTarget,
  type WorkTask,
  type WorkTaskBoard,
  type WorkTaskCreate,
  type WorkTaskScope,
  type WorkTaskStart,
  type WorkTaskTarget,
  type WorkTaskComplete,
  type WorkTaskUpdate,
  type WorkTaskMergeRequest,
  type WorkTaskArchive,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IWorkTaskService, WorkTaskConversationEvent } from "./workTask.js";
import { WorkTaskForgeCoordinator } from "./workTaskForgeCoordinator.js";
import { archiveWorkTask, type WorkTaskCleanupRun } from "./workTaskArchive.js";
import type { WorkTaskServiceOptions } from "./workTaskServiceOptions.js";

interface Run {
  task: WorkTask;
  abort: AbortController;
  promise: Promise<void>;
  conversation?: (event: WorkTaskConversationEvent) => void;
}
const LEASE_MS = 30_000;
const logger = createServiceLogger("work-tasks");

export class WorkTaskService implements IWorkTaskService {
  private readonly owner = randomUUID();
  private readonly runs = new Map<string, Run>();
  private readonly events = new WorkTaskEvents();
  private readonly observations = new Map<string, { key: string; subscription: IDisposable }>();
  private readonly forge: WorkTaskForgeCoordinator;
  private readonly cleaning = new Map<string, WorkTaskCleanupRun>();
  private initialized: Promise<void> | null = null;
  private ticking: Promise<void> | null = null;
  private wakeRequested = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private disposal: Promise<void> | null = null;
  constructor(private readonly options: WorkTaskServiceOptions) {
    const changed = () => this.publish();
    const closed = () => this.closed;
    this.forge = new WorkTaskForgeCoordinator(options, this.owner, changed, closed);
  }

  startScheduler() {
    void this.ready().catch((error) =>
      logger.error(undefined, "Task storage initialization failed", { error: String(error) }),
    );
  }
  private async ready() {
    if (this.closed) throw new Error("work-task.host-closed");
    this.initialized ??= this.options.repo.ready().then(() => {
      if (this.options.allowExecution !== false) this.options.repo.recoverExpired(Date.now());
      if (!this.closed && this.options.allowExecution !== false) {
        this.syncObservations();
        this.timer = setInterval(() => this.wake(), this.options.pollIntervalMs ?? 2000);
        this.timer.unref();
        this.wake();
      }
    });
    await this.initialized;
  }
  private assertLocal(scope: WorkTaskScope) {
    if (this.options.allowExecution === false || scope.workspaceIdentity || scope.remoteSessionId)
      throw new Error("work-task.remote-unsupported");
  }
  private assertNotCleaning(target: WorkTaskTarget) {
    if (this.options.repo.get(target, target.id).worktreeCleanup?.phase === "running")
      throw new Error("work-task.cleanup-in-progress");
  }
  private publish() {
    if (this.events.publish(this.options.repo.revisions())) this.syncObservations();
  }

  private syncObservations() {
    if (this.closed || this.options.allowExecution === false || !this.options.conversation) return;
    const tasks = this.options.repo.conversationTasks();
    const ids = new Set(tasks.map((task) => task.id));
    for (const [id, observation] of this.observations) {
      if (!ids.has(id)) {
        observation.subscription.dispose();
        this.observations.delete(id);
      }
    }
    for (const task of tasks) {
      const key = JSON.stringify([workTaskExecutionPath(task), task.session]);
      const previous = this.observations.get(task.id);
      if (previous?.key === key) continue;
      previous?.subscription.dispose();
      const subscription = this.options.conversation.watch(task, (event) => {
        try {
          this.conversationChanged(task, event);
        } catch (error) {
          logger.error(undefined, "Task conversation observation failed", { error: String(error) });
        }
      });
      this.observations.set(task.id, { key, subscription });
    }
  }
  private conversationChanged(task: WorkTask, event: WorkTaskConversationEvent) {
    if (this.closed) return;
    const existing = this.runs.get(task.id);
    if (existing) {
      if (existing.task.commandId === event.commandId) existing.conversation?.(event);
      return;
    }
    const claimed = this.options.repo.claimConversation(task, this.owner, event, LEASE_MS);
    if (!claimed) return;
    const abort = new AbortController();
    let resolve!: () => void;
    let settled = false;
    const run: Run = {
      task: claimed,
      abort,
      promise: new Promise<void>((done) => {
        resolve = done;
      }),
    };
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      abort.signal.removeEventListener("abort", stop);
      this.finishRun(run, error);
      resolve();
    };
    const stop = () => {
      void this.options.conversation!.stop(claimed, event).then(
        () => finish("work-task.canceled"),
        (error) => finish(error instanceof Error ? error.message : String(error)),
      );
    };
    run.conversation = (change) => {
      if (abort.signal.aborted || settled) return;
      if (change.status === "review" || change.status === "failed") {
        // live 终态同步收口，避免同一事件批次的下一轮开始落在旧租约释放之前。
        finish(
          change.status === "failed" ? change.error || "work-task.agent-interrupted" : undefined,
        );
      } else if (this.options.repo.updateRun(claimed, this.owner, { status: change.status }))
        this.publish();
    };
    abort.signal.addEventListener("abort", stop, { once: true });
    this.runs.set(claimed.id, run);
    this.publish();
  }
  private finishRun(run: Run, error?: string) {
    this.options.repo.finish(run.task, this.owner, error);
    this.forge.onSettled(this.options.repo.get(run.task, run.task.id));
    if (this.runs.get(run.task.id) === run) this.runs.delete(run.task.id);
    this.publish();
    this.wake();
  }
  private wake() {
    if (this.closed || this.options.allowExecution === false) return;
    // 收口与 tick 尾部可能交错；保留唤醒事实，避免下一项被拖到轮询时才认领。
    if (this.ticking) {
      this.wakeRequested = true;
      return;
    }
    this.wakeRequested = false;
    this.ticking = this.tick()
      .catch((error) => logger.error(undefined, "Task scheduler failed", { error: String(error) }))
      .finally(() => {
        this.ticking = null;
        if (this.wakeRequested) this.wake();
      });
  }
  private async tick() {
    await this.options.repo.ready();
    if (this.closed) return;
    const now = Date.now();
    for (const run of this.runs.values()) {
      if (!this.options.repo.renew(run.task, this.owner, now, LEASE_MS)) run.abort.abort();
    }
    for (const run of this.cleaning.values())
      this.options.repo.renew(run.task, this.owner, now, LEASE_MS);
    this.options.repo.recoverExpired(now);
    let task: WorkTask | null;
    while (!this.closed && (task = this.options.repo.claimNext(this.owner, now, LEASE_MS))) {
      const claimed = task;
      const abort = new AbortController();
      const run: Run = { task: claimed, abort, promise: Promise.resolve() };
      this.runs.set(claimed.id, run);
      run.promise = this.execute(run);
    }
    this.publish();
  }
  private async execute(run: Run) {
    let error: string | undefined;
    try {
      this.assertLocal(run.task);
      const execute = isWorkTaskMerging(run.task)
        ? this.options.merge?.execute.bind(this.options.merge)
        : this.options.execute;
      if (!execute) throw new Error("work-task.merge-unsupported");
      await execute(run.task, {
        signal: run.abort.signal,
        update: async (patch) => {
          if (run.abort.signal.aborted || this.closed) return false;
          const updated = this.options.repo.updateRun(run.task, this.owner, patch);
          if (updated) this.publish();
          return updated;
        },
      });
    } catch (cause) {
      error =
        run.abort.signal.aborted && cause instanceof Error && cause.name === "AbortError"
          ? "work-task.canceled"
          : cause instanceof Error
            ? cause.message
            : String(cause);
    } finally {
      this.finishRun(run, error);
    }
  }
  async list(input: WorkTaskScope & { includeArchived?: boolean }): Promise<WorkTaskBoard> {
    const scope = workTaskListSchema.parse(input);
    await this.ready();
    return {
      tasks: this.options.repo.list(scope, scope.includeArchived),
      concurrency: this.options.repo.concurrency(scope),
    };
  }
  async create(input: WorkTaskCreate) {
    const parsed = workTaskCreateSchema.parse(input);
    await this.ready();
    await this.validateAttachments(parsed, parsed.attachments);
    await this.forge.validateSource(parsed);
    const task = this.options.repo.create(parsed);
    this.publish();
    return task;
  }
  async update(input: WorkTaskUpdate) {
    const parsed = workTaskUpdateSchema.parse(input);
    await this.ready();
    await this.validateAttachments(parsed, parsed.attachments);
    const task = this.options.repo.update(parsed);
    this.publish();
    return task;
  }
  private attachmentStore(scope: WorkTaskScope) {
    this.assertLocal(scope);
    if (this.closed) throw new Error("work-task.host-closed");
    if (!this.options.attachments) throw new Error("work-task.attachments-unsupported");
    return this.options.attachments;
  }
  private async validateAttachments(scope: WorkTaskScope, attachments?: WorkTaskAttachment[]) {
    if (attachments?.length) await this.attachmentStore(scope).validate(scope, attachments);
    if (this.closed) throw new Error("work-task.host-closed");
  }
  async attachmentImport(input: WorkTaskAttachmentImport) {
    const parsed = workTaskAttachmentImportSchema.parse(input);
    return this.attachmentStore(parsed).importFile(parsed);
  }
  async attachmentBegin(input: WorkTaskAttachmentBegin) {
    const parsed = workTaskAttachmentBeginSchema.parse(input);
    return this.attachmentStore(parsed).begin(parsed);
  }
  async attachmentChunk(input: WorkTaskAttachmentChunk) {
    const parsed = workTaskAttachmentChunkSchema.parse(input);
    return this.attachmentStore(parsed).chunk(parsed);
  }
  async attachmentCommit(input: WorkTaskAttachmentTarget) {
    const parsed = workTaskAttachmentTargetSchema.parse(input);
    return this.attachmentStore(parsed).commit(parsed);
  }
  async attachmentAbort(input: WorkTaskAttachmentTarget) {
    const parsed = workTaskAttachmentTargetSchema.parse(input);
    return this.attachmentStore(parsed).abort(parsed);
  }
  async start(input: WorkTaskStart) {
    const parsed = workTaskStartSchema.parse(input);
    this.assertLocal(parsed);
    await this.ready();
    const task = this.options.repo.enqueue(parsed, parsed.id, parsed.feedback);
    this.publish();
    this.wake();
    return task;
  }
  async startAll(input: WorkTaskScope) {
    const scope = workTaskScopeSchema.strict().parse(input);
    this.assertLocal(scope);
    await this.ready();
    this.options.repo.enqueueAll(scope);
    this.publish();
    this.wake();
  }
  async cancel(input: WorkTaskTarget) {
    const parsed = workTaskTargetSchema.parse(input);
    await this.ready();
    this.assertNotCleaning(parsed);
    const task = this.options.repo.cancel(parsed, parsed.id);
    this.runs.get(task.id)?.abort.abort();
    this.publish();
    this.wake();
    return task;
  }
  async complete(input: WorkTaskComplete) {
    const parsed = workTaskCompleteSchema.parse(input);
    await this.ready();
    this.assertNotCleaning(parsed);
    return this.forge.complete(parsed);
  }
  async merge(input: WorkTaskMergeRequest) {
    const parsed = workTaskMergeRequestSchema.parse(input);
    this.assertLocal(parsed);
    await this.ready();
    if (!this.options.merge) throw new Error("work-task.merge-unsupported");
    const current = this.options.repo.get(parsed, parsed.id);
    const { projectPath } = await this.options.merge.validate(current, parsed.targetBranch);
    if (this.closed) throw new Error("work-task.host-closed");
    this.assertNotCleaning(parsed);
    const task = this.options.repo.enqueueMerge(parsed, projectPath);
    this.publish();
    this.wake();
    return task;
  }
  async archive(input: WorkTaskArchive) {
    const parsed = workTaskArchiveSchema.parse(input);
    if (parsed.removeWorktree) this.assertLocal(parsed);
    await this.ready();
    const task = archiveWorkTask(this.options.repo, parsed, {
      active: this.cleaning,
      owner: this.owner,
      leaseMs: LEASE_MS,
      publish: () => this.publish(),
      remove: this.options.removeWorktree,
      isClosed: () => this.closed,
    });
    this.publish();
    this.cleaning
      .get(task.id)
      ?.promise.catch((error) =>
        logger.error(undefined, "Worktree cleanup persistence failed", { error: String(error) }),
      );
    return task;
  }
  async setConcurrency(input: WorkTaskScope & { concurrency: number }) {
    const parsed = workTaskConcurrencySchema.parse(input);
    await this.ready();
    this.options.repo.setConcurrency(parsed, parsed.concurrency);
    this.publish();
    this.wake();
  }
  async getEvents(input: WorkTaskTarget) {
    const parsed = workTaskTargetSchema.parse(input);
    await this.ready();
    return this.options.repo.events(parsed, parsed.id);
  }
  onDynamicChanged(input: WorkTaskScope): Event<void> {
    const scope = workTaskScopeSchema.strict().parse(input);
    return this.events.subscribe(scope);
  }

  disposeAll() {
    if (this.closed) return;
    this.closed = true;
    for (const observation of this.observations.values()) observation.subscription.dispose();
    this.observations.clear();
    if (this.timer) clearInterval(this.timer);
    this.disposal = this.stopAndClose();
  }
  private async stopAndClose() {
    await this.options.attachments?.dispose();
    await this.initialized?.catch(() => {});
    await this.ticking;
    if (this.initialized) {
      await Promise.allSettled([...this.cleaning.values()].map((run) => run.promise));
      this.options.repo.interruptOwned(this.owner);
      for (const run of this.runs.values()) run.abort.abort();
      await Promise.all([...this.runs.values()].map((run) => run.promise));
      await this.forge.drain();
      this.options.repo.close();
    }
    this.events.dispose();
  }
  async disposeAllAndWait() {
    this.disposeAll();
    await this.disposal;
  }
}
