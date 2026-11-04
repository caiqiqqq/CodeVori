import type { ChildProcess } from "node:child_process";
import {
  terminateProcessTreeAndWait,
  type ProcessTreeTerminatorLogger,
} from "../process/processTreeTerminator.js";

/** One owner for close admission and completion, including unexpected adapter exit. */
export function createAcpConnectionCleanup(input: {
  child: ChildProcess;
  disposeTerminals: () => Promise<void>;
  log: ProcessTreeTerminatorLogger;
  ownedProcessStartedAtMs: number;
  resolveOwnedProcessExitedAtMs: () => number | undefined;
}) {
  let requested = false;
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // 非等待调用也必须观察失败；原始 Promise 仍将失败交给等待关闭的 owner。
  void closed.catch(() => input.log.warn(undefined, "ACP process cleanup failed"));
  return {
    get requested() {
      return requested;
    },
    closed,
    close() {
      if (requested) return;
      requested = true;
      const { child } = input;
      // 修复原因：根进程 close 早于 MCP 后代退出；复用 API 等待式树回收，
      // 将强杀和身份复核纳入同一 closed 屏障，异常 exit 也走同一清理路径。
      const treeClosed = terminateProcessTreeAndWait(child, {
        ...(process.platform !== "win32" && child.pid ? { ownedProcessGroupId: child.pid } : {}),
        ownedProcessStartedAtMs: input.ownedProcessStartedAtMs,
        resolveOwnedProcessExitedAtMs: input.resolveOwnedProcessExitedAtMs,
        keepForceTimerRef: true,
        log: input.log,
      }).then(({ remainingPids }) => {
        if (remainingPids.length)
          throw new Error(`ACP process cleanup incomplete (${remainingPids.length} remaining)`);
      });
      const terminalsClosed = Promise.resolve().then(input.disposeTerminals);
      void Promise.allSettled([treeClosed, terminalsClosed]).then((results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length) fail(new AggregateError(errors, "ACP cleanup failed"));
        else finish();
      });
    },
  };
}
