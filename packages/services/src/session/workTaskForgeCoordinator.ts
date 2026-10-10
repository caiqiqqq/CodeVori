import {
  isWorkTaskForgePending,
  workTaskCompleteSchema,
  type WorkTask,
  type WorkTaskComplete,
  type WorkTaskCreate,
} from "@zcode/shared";
import type { WorkTaskServiceOptions } from "./workTaskServiceOptions.js";
import { writebackWorkTaskForge } from "./workTaskForgeWriteback.js";
import { WorkTaskResultCoordinator } from "./workTaskResultCoordinator.js";

/** Task-service-owned command coordination; no independent queue or automatic retries. */
export class WorkTaskForgeCoordinator {
  readonly result: WorkTaskResultCoordinator;
  private readonly pending = new Map<string, Promise<WorkTask>>();
  constructor(
    private readonly options: WorkTaskServiceOptions,
    private readonly owner: string,
    private readonly publish: () => void,
    private readonly closed: () => boolean,
    private readonly ready: () => Promise<void>,
  ) {
    this.result = new WorkTaskResultCoordinator(options, closed, ready);
  }
  async validateSource(input: WorkTaskCreate) {
    if (!input.source) return;
    if (!this.options.forge) throw new Error("work-task.forge-unsupported");
    const item = await this.options.forge.getForgeItem({
      ...input.source,
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
    });
    if (!item.url || item.number !== input.source.number || item.kind !== input.source.kind)
      throw new Error("FORGE_INVALID_ITEM");
    input.source = { ...input.source, url: item.url, title: item.title.slice(0, 256) };
    if (this.closed()) throw new Error("work-task.host-closed");
  }
  async complete(input: WorkTaskComplete): Promise<WorkTask> {
    input = workTaskCompleteSchema.parse(input);
    await this.ready();
    if (this.pending.has(input.id)) throw new Error("work-task.forge-busy");
    let task = this.options.repo.get(input, input.id);
    // 后台清理期间沿用主线的准入限制，完成及回写统一由当前任务事实决定。
    if (task.worktreeCleanup?.phase === "running") throw new Error("work-task.cleanup-in-progress");
    if (task.status !== "done") {
      const records = await this.result.capture(task, input.forge);
      task = this.options.repo.complete(input, input.id, input.forge, records);
    } else if (!task.forgeWriteback) throw new Error("work-task.not-reviewable");
    this.publish();
    return isWorkTaskForgePending(task)
      ? this.writeback(task, input.resendComment)
      : Promise.resolve(task);
  }
  onSettled(task: WorkTask) {
    if (!this.closed() && task.status === "done" && isWorkTaskForgePending(task))
      void this.writeback(task).catch(() => {
        /* 已持久化失败，等待显式重试。 */
      });
  }
  private writeback(task: WorkTask, resendComment = false): Promise<WorkTask> {
    if (!this.options.forge) return Promise.reject(new Error("work-task.forge-unsupported"));
    if (this.pending.has(task.id)) return Promise.reject(new Error("work-task.forge-busy"));
    const request = writebackWorkTaskForge({
      task,
      repo: this.options.repo,
      forge: this.options.forge,
      owner: this.owner,
      publish: this.publish,
      closed: this.closed,
      resendComment,
      readRecords: this.options.result
        ? (task) => this.options.result!.records(task, task.merge?.targetBranch)
        : undefined,
    });
    this.pending.set(task.id, request);
    void request.finally(() => this.pending.delete(task.id)).catch(() => {});
    return request;
  }
  async drain() {
    await Promise.allSettled(this.pending.values());
  }
}
