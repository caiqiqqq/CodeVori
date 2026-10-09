import type { WorkTask, WorkTaskArchive } from "@zcode/shared";
import type { WorkTaskRepo } from "./workTaskRepo.js";
import { createWorktreeRemovalTiming } from "#src/logger/worktreeRemovalTiming.js";

export async function archiveWorkTask(
  repo: WorkTaskRepo,
  input: WorkTaskArchive,
  cleanup: {
    active: Set<string>;
    remove?: (task: WorkTask) => Promise<void>;
    isClosed(): boolean;
  },
) {
  const current = repo.get(input, input.id);
  if (cleanup.active.has(current.id)) throw new Error("work-task.cleanup-in-progress");
  if (!input.removeWorktree) return repo.archive(input, input.id, input.archived);
  const assertCleanable = (task: WorkTask) => {
    if (task.status !== "done" || task.stopPending || !task.worktree || task.useWorktree === false)
      throw new Error("work-task.not-cleanable");
  };
  assertCleanable(current);
  const remove = cleanup.remove;
  if (!remove) throw new Error("work-task.cleanup-unsupported");
  cleanup.active.add(current.id);
  const timing = createWorktreeRemovalTiming("archive", current.worktree!.path);
  let outcome = "failed";
  try {
    // 同一 Host 先删除再归档；目录删除后落库中断由原 Git 幂等检查支持显式重试。
    await timing.run("worktree-cleanup", () => remove(current));
    timing.measure("task-revalidation", () => {
      if (cleanup.isClosed()) throw new Error("work-task.host-closed");
      assertCleanable(repo.get(input, input.id));
    });
    const result = timing.measure("archive-transaction", () => repo.archive(input, input.id, true));
    outcome = "success";
    return result;
  } finally {
    cleanup.active.delete(current.id);
    timing.finish(outcome);
  }
}
