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
      // 任务先落盘为 done；评论所需的 Git 证据由下方异步回写在最终状态上读取并冻结。
      task = this.options.repo.complete(input, input.id, input.forge);
    } else if (!task.forgeWriteback) throw new Error("work-task.not-reviewable");
    this.publish();
    if (isWorkTaskForgePending(task)) {
      const receipt = task.forgeWriteback!;
      // 另一 Host 已持有未过期回写租约时，仍需同步拒绝重复受理；真正的网络步骤随后异步执行。
      if (receipt.owner && (receipt.leaseUntil ?? 0) > Date.now())
        throw new Error("work-task.forge-busy");
      this.scheduleWriteback(task, input.resendComment);
    }
    // 修复依据：本地完成事实已在上面事务提交；远端评论/关闭可能长时间等待，不能让确认命令把 UI
    // 或其它任务锁在网络请求上。回写失败由持久化收据承载，沿用显式重试路径。
    return task;
  }
  onSettled(task: WorkTask) {
    if (!this.closed() && task.status === "done" && isWorkTaskForgePending(task))
      this.scheduleWriteback(task);
  }
  private scheduleWriteback(task: WorkTask, resendComment = false) {
    void this.writeback(task, resendComment).catch(() => {
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
