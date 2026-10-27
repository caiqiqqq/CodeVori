import { setTimeout as delay } from "node:timers/promises";

/** 初始化仍由 Repo 的单飞 Promise 所有；SQLite 同步等待只占一个短片段。 */
export const TASKS_INITIALIZATION_BUSY_TIMEOUT_MS = 25;

export async function retryTasksDatabaseInitialization(
  initialize: () => Promise<void>,
  releaseFailedConnection: () => void,
  waitBudgetMs: number,
): Promise<void> {
  const deadline = performance.now() + waitBudgetMs;
  for (;;) {
    try {
      await initialize();
      return;
    } catch (error) {
      const code = (error as { errcode?: number } | null)?.errcode;
      if (typeof code !== "number" || (code & 0xff) !== 5) throw error;
      // 迁移后维护曾沿用最长一小时的 busy_timeout，同步等锁会冻住整个 Worker。
      // 关闭失败连接再异步重试幂等初始化，不能清空 Repo 的 initializePromise 破坏单飞。
      try {
        releaseFailedConnection();
      } catch {
        // 清理失败不能覆盖最初锁错误，也不能带着未知事务状态重试。
        throw error;
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw error;
      await delay(Math.min(100, remaining));
    }
  }
}
