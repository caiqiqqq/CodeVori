import {
  isWorkTaskMerging,
  workTaskResultDraftSchema,
  resolveWorkspaceKey,
  workTaskResultRequestSchema,
  workTaskResultCancelSchema,
  workTaskResultSourceRequestSchema,
  workTaskResultSourceSchema,
  type WorkTaskResultSourceRequest,
  type WorkTask,
  type WorkTaskResultRequest,
  type WorkTaskResultCancel,
} from "@zcode/shared";
import { assertWorkTaskLocal } from "./workTask.js";
import type { WorkTaskServiceOptions } from "./workTaskServiceOptions.js";

export class WorkTaskResultCoordinator {
  private readonly pending = new Map<
    string,
    { taskId: string; scope: string; runSeq: number; abort: AbortController }
  >();
  constructor(
    private readonly options: WorkTaskServiceOptions,
    private readonly closed: () => boolean,
    private readonly ready: () => Promise<void> = async () => {
      await options.repo.ready();
    },
  ) {}
  async source(input: WorkTaskResultSourceRequest) {
    input = workTaskResultSourceRequestSchema.parse(input);
    const task = await this.reviewable(input);
    const source = await this.options.result!.source(task);
    this.assertUnchanged(task);
    return workTaskResultSourceSchema.parse(source);
  }
  private async reviewable(input: WorkTaskResultSourceRequest) {
    if (this.closed()) throw new Error("work-task.result-canceled");
    assertWorkTaskLocal(input, this.options.allowExecution);
    await this.ready();
    const task = this.options.repo.get(input, input.id);
    if (
      task.status !== "review" ||
      task.archived ||
      task.stopPending ||
      !task.session ||
      isWorkTaskMerging(task) ||
      task.runSeq !== input.runSeq
    )
      throw new Error("work-task.not-reviewable");
    if (!this.options.result) throw new Error("work-task.result-unsupported");
    return task;
  }
  async generate(input: WorkTaskResultRequest) {
    input = workTaskResultRequestSchema.parse(input);
    const task = await this.reviewable(input);
    if (
      this.pending.has(input.requestId) ||
      [...this.pending.values()].some((p) => p.taskId === task.id)
    )
      throw new Error("work-task.result-busy");
    const abort = new AbortController();
    this.pending.set(input.requestId, {
      taskId: task.id,
      scope: resolveWorkspaceKey(task),
      runSeq: task.runSeq,
      abort,
    });
    try {
      const result = await this.options.result!.generate(task, input, abort.signal);
      if (abort.signal.aborted || this.closed()) throw new Error("work-task.result-canceled");
      this.assertUnchanged(task);
      const draft = workTaskResultDraftSchema.safeParse(result);
      if (!draft.success) throw new Error("work-task.result-invalid-output");
      return draft.data;
    } finally {
      this.pending.delete(input.requestId);
    }
  }
  async cancel(input: WorkTaskResultCancel) {
    input = workTaskResultCancelSchema.parse(input);
    await this.ready();
    this.options.repo.get(input, input.id);
    const pending = this.pending.get(input.requestId);
    if (
      pending &&
      pending.taskId === input.id &&
      pending.scope === resolveWorkspaceKey(input) &&
      pending.runSeq === input.runSeq
    )
      pending.abort.abort();
  }
  assertUnchanged(task: WorkTask) {
    // 只读来源也可能晚于 Host 关闭返回；先检查所有者，不能再访问已关闭的数据库。
    if (this.closed()) throw new Error("work-task.result-canceled");
    const current = this.options.repo.get(task, task.id);
    if (
      current.runSeq !== task.runSeq ||
      current.updatedAt !== task.updatedAt ||
      current.status !== task.status ||
      current.stopPending
    )
      throw new Error("work-task.result-source-changed");
  }
  dispose() {
    for (const pending of this.pending.values()) pending.abort.abort();
  }
}
