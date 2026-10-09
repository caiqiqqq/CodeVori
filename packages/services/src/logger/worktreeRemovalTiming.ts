import { createHash } from "node:crypto";
import { createServiceLogger, type ServiceLogger } from "./serviceLogger.js";

const log = createServiceLogger("worktree-removal");

/** 仅用于显式删除：每层结束时输出一次摘要，不采集路径、正文或 Git 输出。 */
export function createWorktreeRemovalTiming(
  layer: "git" | "runtime" | "archive",
  worktreePath: string,
  logger: ServiceLogger = log,
) {
  const started = performance.now();
  const targetKey = createHash("sha256").update(worktreePath).digest("hex");
  const phasesMs: Record<string, number> = {};
  let lastPhase = "admission";
  let finished = false;
  const record = (phase: string, start: number) => {
    phasesMs[phase] = Math.round((phasesMs[phase] ?? 0) + performance.now() - start);
  };
  return {
    async run<T>(phase: string, action: () => Promise<T>): Promise<T> {
      lastPhase = phase;
      const start = performance.now();
      try {
        return await action();
      } finally {
        record(phase, start);
      }
    },
    measure<T>(phase: string, action: () => T): T {
      lastPhase = phase;
      const start = performance.now();
      try {
        return action();
      } finally {
        record(phase, start);
      }
    },
    finish(status: string): void {
      if (finished) return;
      finished = true;
      // 修复依据：诊断 sink 失败不能把已完成的目录删除改成失败，也不能触发重试。
      try {
        logger.info(undefined, "Worktree removal timing", {
          layer,
          targetKey,
          status,
          lastPhase,
          durationMs: Math.round(performance.now() - started),
          phasesMs,
        });
      } catch {
        // 删除/归档的业务结果优先于诊断输出。
      }
    },
  };
}
