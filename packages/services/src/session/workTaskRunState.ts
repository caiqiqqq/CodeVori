import { WORK_TASK_ACTIVE_STATUSES, type WorkTask } from "@zcode/shared";

export function finishWorkTaskRun(
  current: WorkTask,
  run: WorkTask,
  input: {
    error?: string;
    leaseExpired: boolean;
    now: number;
  },
): { task: WorkTask; type: string } {
  const failure = input.leaseExpired ? "work-task.host-interrupted" : input.error;
  if (run.merge && current.merge?.id === run.merge.id) {
    const canceled =
      current.merge.phase === "canceled" && (!failure || failure === "work-task.canceled");
    const merged = current.merge.phase === "merged" && !failure;
    const reason = merged || canceled ? undefined : failure || "work-task.merge-incomplete";
    return {
      task: {
        ...current,
        status: merged ? "done" : "review",
        stopPending: false,
        completion: merged ? "merged" : undefined,
        failureReason: reason,
        merge: {
          ...current.merge,
          phase: merged ? "merged" : canceled ? "canceled" : "failed",
          error: reason,
        },
        updatedAt: input.now,
      },
      type: merged ? "merged" : "merge-settled",
    };
  }
  // 取消/关机先撤销运行资格；晚到结果只释放租约，不能把终态改回审阅。
  const active = WORK_TASK_ACTIVE_STATUSES.includes(current.status);
  const stopFailure = !active && input.error && input.error !== "work-task.canceled";
  return {
    task: {
      ...current,
      status: active ? (failure ? "failed" : "review") : stopFailure ? "failed" : current.status,
      failureReason: active ? failure : stopFailure ? input.error : current.failureReason,
      stopPending: false,
      updatedAt: input.now,
    },
    type: active ? "settled" : "stopped",
  };
}

export function interruptWorkTaskRun(task: WorkTask, now: number, stopPending: boolean): WorkTask {
  // 处理轮次可能已写入 merged/canceled，但 owner 尚未收口；恢复仍需保留合并审查语义。
  const merging = !!task.merge;
  return {
    ...task,
    status: merging
      ? "review"
      : stopPending
        ? task.status === "canceled"
          ? "canceled"
          : "failed"
        : WORK_TASK_ACTIVE_STATUSES.includes(task.status)
          ? "failed"
          : task.status,
    failureReason:
      !merging && task.status === "canceled" ? undefined : "work-task.host-interrupted",
    ...(merging
      ? { merge: { ...task.merge!, phase: "failed" as const, error: "work-task.host-interrupted" } }
      : {}),
    stopPending,
    updatedAt: now,
  };
}
