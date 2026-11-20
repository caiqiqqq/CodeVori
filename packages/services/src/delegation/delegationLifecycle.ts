import type { DelegationTask, DelegationResult } from "@zcode/shared";
import type { DelegationDependencies } from "./contract.js";
import type { WorkTaskExecutionContext } from "../session/contract.js";
import type { DelegationRepository } from "./delegationRepository.js";

const terminal = new Set(["completed", "failed", "interrupted", "canceled"]);
export function squadChildren(repo: DelegationRepository, task: DelegationTask) {
  return task.session
    ? repo.list({
        ...task.parent,
        workspacePath: task.worktree?.path ?? task.parent.workspacePath,
        kind: task.session.kind,
        sessionId: task.session.id,
      })
    : [];
}
export function cancelDelegationTree(repo: DelegationRepository, task: DelegationTask) {
  if (!terminal.has(task.status)) {
    task.status = "canceled";
    task.updatedAt = Date.now();
    const attempt = task.attempts.at(-1);
    if (attempt && !attempt.endedAt) {
      attempt.status = "canceled";
      attempt.endedAt = task.updatedAt;
    }
  }
  for (const item of task.attempts) if (item.delivery !== "delivered") item.delivery = "suppressed";
  delete task.owner;
  delete task.leaseUntil;
  repo.put(task);
  if (task.session) {
    const parent = {
      ...task.parent,
      workspacePath: task.worktree?.path ?? task.parent.workspacePath,
      kind: task.session.kind,
      sessionId: task.session.id,
    };
    // 已完成的下级也可能有待回传结果；取消树不能只遍历正在执行的节点。
    const state = repo.parent(parent);
    repo.setParent(parent, { generation: state.generation + 1, suspended: true });
    for (const child of repo.list(parent)) cancelDelegationTree(repo, child);
  }
}
export async function executeWithSquadCleanup(
  repo: DelegationRepository,
  owner: string,
  task: DelegationTask,
  context: WorkTaskExecutionContext,
  execute: DelegationDependencies["execute"],
  disposed: () => boolean,
  abortCanceled: () => void,
): Promise<DelegationResult> {
  let outcome: { result: DelegationResult } | { error: unknown };
  try {
    outcome = { result: await execute(task, context) };
  } catch (error) {
    outcome = { error };
  }
  let unfinished = false;
  if (!disposed() && task.squad?.role === "leader") {
    // 在同一事务内检查 lease/run 并收回成员，避免另一 Host 已恢复任务后被旧执行取消。
    unfinished = repo.transaction(() => {
      const current = repo.get(task.id);
      if (
        current?.owner !== owner ||
        (current.leaseUntil ?? 0) <= Date.now() ||
        current.attempts.at(-1)?.commandId !== task.attempts.at(-1)?.commandId
      )
        return false;
      const pending = squadChildren(repo, current).filter((child) => !terminal.has(child.status));
      for (const child of pending) cancelDelegationTree(repo, child);
      return pending.length > 0;
    });
    if (unfinished) abortCanceled();
  }
  if ("error" in outcome) throw outcome.error;
  if (unfinished) throw new Error("delegation.squad-members-pending");
  return outcome.result;
}
