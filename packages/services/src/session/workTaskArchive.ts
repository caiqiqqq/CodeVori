import type { WorkTask, WorkTaskArchive } from "@zcode/shared";
import type { WorkTaskRepo } from "./workTaskRepo.js";
import { createWorktreeRemovalTiming } from "#src/logger/worktreeRemovalTiming.js";

export interface WorkTaskCleanupRun {
  task: WorkTask;
  promise: Promise<void>;
}

export function archiveWorkTask(
  repo: WorkTaskRepo,
  input: WorkTaskArchive,
  cleanup: {
    active: Map<string, WorkTaskCleanupRun>;
    owner: string;
    leaseMs: number;
    remove?: (task: WorkTask) => Promise<void>;
    isClosed(): boolean;
    publish(): void;
  },
): WorkTask {
  if (!input.removeWorktree) return repo.archive(input, input.id, input.archived);
  const remove = cleanup.remove;
  if (!remove) throw new Error("work-task.cleanup-unsupported");
  // 即使租约已过期，也不能覆盖本 Host 尚未结束的清理句柄，否则关闭时会漏等旧 IO。
  const current = repo.get(input, input.id);
  if (cleanup.active.has(current.id)) throw new Error("work-task.cleanup-in-progress");
  const task = repo.beginWorktreeCleanup(input, input.id, cleanup.owner, cleanup.leaseMs);
  const timing = createWorktreeRemovalTiming("archive", task.worktree!.path);
  const run: WorkTaskCleanupRun = { task, promise: Promise.resolve() };
  // 修复依据：先持久化并发布受理事实，再执行磁盘 IO；RPC 不等待 Git 删除。
  run.promise = Promise.resolve().then(async () => {
    let error: string | undefined;
    try {
      await timing.run("worktree-cleanup", () => remove(task));
      if (cleanup.isClosed()) error = "work-task.host-interrupted";
    } catch (cause) {
      // 清理状态只保存稳定业务码，不把 Git 输出或用户路径写入持久错误。
      const message = cause instanceof Error ? cause.message : "";
      error = /^work-task\.[a-z-]+$/.test(message)
        ? message
        : "work-task.worktree-remove-command-failed";
    }
    try {
      const applied = timing.measure("archive-transaction", () =>
        repo.finishWorktreeCleanup(task, cleanup.owner, error),
      );
      timing.finish(applied ? (error ? "failed" : "success") : "stale");
    } finally {
      if (cleanup.active.get(task.id) === run) cleanup.active.delete(task.id);
      timing.finish("failed");
      cleanup.publish();
    }
  });
  cleanup.active.set(task.id, run);
  return task;
}
