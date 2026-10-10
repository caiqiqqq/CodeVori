import {
  isWorkTaskMerging,
  workTaskResultDraftSchema,
  workTaskChangeRecordSchema,
  resolveWorkspaceKey,
  workTaskResultRequestSchema,
  workTaskResultCancelSchema,
  type WorkTask,
  type WorkTaskResultRequest,
  type WorkTaskResultCancel,
  type WorkTaskForgeOptions,
  type WorkTaskChangeRecord,
} from "@zcode/shared";
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
  async generate(input: WorkTaskResultRequest) {
    input = workTaskResultRequestSchema.parse(input);
    if (this.options.allowExecution === false || input.workspaceIdentity || input.remoteSessionId)
      throw new Error("work-task.remote-unsupported");
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
      const text = await this.options.result.generate(task, input, abort.signal);
      if (abort.signal.aborted || this.closed()) throw new Error("work-task.result-canceled");
      this.assertUnchanged(task);
      const draft = workTaskResultDraftSchema.safeParse({ text });
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
    const current = this.options.repo.get(task, task.id);
    if (
      current.runSeq !== task.runSeq ||
      current.updatedAt !== task.updatedAt ||
      current.status !== task.status ||
      current.stopPending ||
      this.closed()
    )
      throw new Error("work-task.result-source-changed");
  }
  async capture(
    task: WorkTask,
    forge?: WorkTaskForgeOptions,
    targetBranch?: string,
  ): Promise<WorkTaskChangeRecord | undefined> {
    if (!forge?.comment || !task.source) {
      this.assertUnchanged(task);
      return undefined;
    }
    let record: WorkTaskChangeRecord = {
      state: "unknown",
      commits: [],
      files: [],
      uncommitted: [],
      truncated: false,
    };
    if (this.options.result) {
      try {
        record = workTaskChangeRecordSchema.parse(
          await this.options.result.records(task, targetBranch),
        );
      } catch {
        /* 证据读取失败必须明确未知，不能把错误变成“没有修改”。 */
      }
    }
    this.assertUnchanged(task);
    return record;
  }
  dispose() {
    for (const pending of this.pending.values()) pending.abort.abort();
  }
}
