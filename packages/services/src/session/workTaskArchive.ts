import type { WorkTask, WorkTaskArchive } from "@zcode/shared";
import type { WorkTaskRepo } from "./workTaskRepo.js";

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
  if (!cleanup.remove) throw new Error("work-task.cleanup-unsupported");
  cleanup.active.add(current.id);
  try {
    // 同一 Host 先删除再归档；目录删除后落库中断由原 Git 幂等检查支持显式重试。
    await cleanup.remove(current);
    if (cleanup.isClosed()) throw new Error("work-task.host-closed");
    assertCleanable(repo.get(input, input.id));
    return repo.archive(input, input.id, true);
  } finally {
    cleanup.active.delete(current.id);
  }
}
