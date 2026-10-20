import type { WorkTaskExecutionContext } from "../session/contract.js";

export async function commitWorkTaskExecution(
  context: WorkTaskExecutionContext,
  patch: Parameters<WorkTaskExecutionContext["update"]>[0],
) {
  context.signal.throwIfAborted();
  const owned = await context.update(patch);
  // 保存期间取消会令 update 返回 false；先判断取消，避免把正常取消误报为执行失败。
  context.signal.throwIfAborted();
  if (!owned) throw new Error("work-task.ownership-lost");
}
