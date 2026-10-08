import { resolveWorkspaceKey, uuidv7, type DelegationTask } from "@zcode/shared";
import { parentKey, type DelegationRepository } from "./delegationRepository.js";
const active = new Set(["preparing", "running", "awaiting_input"]);
const terminal = new Set(["completed", "failed", "interrupted", "canceled"]);
const leaseMs = 30_000;

export function claimDelegations(
  repo: DelegationRepository,
  owner: string,
  owned: ReadonlySet<string>,
  cancel: (task: DelegationTask) => void,
) {
  const claimed: DelegationTask[] = [];
  repo.transaction(() => {
    const now = Date.now();
    const tasks = repo.list();
    for (const task of tasks) {
      if (!active.has(task.status)) continue;
      if (task.owner === owner && owned.has(task.id)) {
        task.leaseUntil = now + leaseMs;
        repo.put(task);
      } else if ((task.leaseUntil ?? 0) <= now) {
        // 失联执行可能已写文件：只标中断，必须显式 resume，不能自动重放。
        task.status = "interrupted";
        delete task.owner;
        delete task.leaseUntil;
        const attempt = task.attempts.at(-1)!;
        attempt.status = "interrupted";
        attempt.error = "智能体执行已中断，请检查子会话后恢复。";
        attempt.endedAt = now;
        attempt.delivery = "pending";
        repo.put(task);
      }
    }
    for (const task of tasks) {
      if (task.status !== "queued") continue;
      const parent = repo.parent(task.rootParent);
      if (parent.suspended || task.generation !== parent.generation) {
        cancel(task);
        continue;
      }
      const dependencies = task.dependsOn.map((id) => repo.get(id));
      if (dependencies.some((d) => !d || (terminal.has(d.status) && d.status !== "completed"))) {
        task.status = "failed";
        task.attempts.push({
          sequence: task.attempts.length + 1,
          commandId: uuidv7(),
          startedAt: now,
          endedAt: now,
          status: "failed",
          error: "前置任务未成功",
          delivery: "pending",
          deliveryCommandId: uuidv7(),
        });
        repo.put(task);
        continue;
      }
      if (dependencies.some((d) => d?.status !== "completed")) continue;
      const settings = repo.settings(task.rootParent);
      const running = tasks.filter((t) => active.has(t.status));
      const workspaceTasks = tasks.filter(
        (t) => resolveWorkspaceKey(t.rootParent) === resolveWorkspaceKey(task.rootParent),
      );
      const workspaceRunning = workspaceTasks.filter((t) => active.has(t.status));
      // 调低设置不能堵住已接受的子任务；从未结束链条推导容量，完成后自动回落到配置值。
      const depth = Math.max(
        settings.allowNested ? settings.maxDepth : 1,
        ...workspaceTasks.filter((t) => !terminal.has(t.status)).map((t) => t.depth),
      );
      const concurrency = Math.max(settings.concurrency, depth);
      if (
        workspaceRunning.length >= concurrency ||
        // 嵌套父任务可能阻塞等待子任务；每个更深层级保留一个容量，避免父任务占满。
        (depth > 1 &&
          workspaceRunning.filter((t) => t.depth <= task.depth).length >=
            concurrency - Math.max(0, depth - task.depth))
      )
        continue;
      if (task.session && running.some((t) => t.session?.id === task.session?.id)) continue;
      task.status = "preparing";
      task.owner = owner;
      task.leaseUntil = now + leaseMs;
      task.attempts.push({
        sequence: task.attempts.length + 1,
        commandId: uuidv7(),
        startedAt: now,
        status: "preparing",
        deliveryCommandId: uuidv7(),
      });
      repo.put(task);
      claimed.push(task);
    }
  });
  return claimed;
}

export async function deliverDelegationResults(
  repo: DelegationRepository,
  owner: string,
  deliver: (task: DelegationTask, commandId: string, text: string) => Promise<boolean>,
  disposed: () => boolean,
) {
  const seen = new Set<string>();
  for (const task of repo.list()) {
    const key = parentKey(task.parent);
    if (seen.has(key)) continue;
    for (const attempt of task.attempts) {
      if (seen.has(key)) break;
      if (!attempt?.delivery) continue;
      if (attempt.delivery === "sending" && (attempt.deliveryLeaseUntil ?? 0) < Date.now()) {
        repo.transaction(() => {
          const current = repo.get(task.id)!;
          const a = current.attempts.find((item) => item.sequence === attempt.sequence);
          if (a?.delivery === "sending" && (a.deliveryLeaseUntil ?? 0) < Date.now()) {
            a.delivery = "uncertain";
            repo.put(current);
          }
        });
        continue;
      }
      if (attempt.delivery !== "pending" || repo.parent(task.rootParent).suspended) continue;
      const accepted = repo.transaction(() => {
        const current = repo.get(task.id)!;
        const a = current.attempts.find((item) => item.sequence === attempt.sequence)!;
        const state = repo.parent(task.rootParent);
        if (
          state.suspended ||
          state.generation !== task.generation ||
          a.delivery !== "pending" ||
          a.sequence !== attempt.sequence
        )
          return false;
        // 不同窗口也只能为同一父会话派送一条通知，不能用 UI busy 状态做锁。
        if (
          repo.list(task.parent).some((t) => t.attempts.some((item) => item.delivery === "sending"))
        )
          return false;
        a.delivery = "sending";
        a.deliveryOwner = owner;
        a.deliveryLeaseUntil = Date.now() + leaseMs;
        repo.put(current);
        return true;
      });
      if (!accepted) continue;
      seen.add(key);
      const text = `ZCode 智能体委派结果（taskId=${task.id}）：${JSON.stringify({ title: task.title, attempt: attempt.sequence, agent: task.execution, status: attempt.status, result: attempt.result, error: attempt.error, session: task.session, workspacePath: task.worktree?.path ?? task.parent.workspacePath })}\n仅向用户汇总结论、证据和风险；没有新的用户授权，不继续修改、合并、提交或推送。`;
      let delivery: "pending" | "delivered" | "uncertain";
      try {
        delivery = (await deliver(task, attempt.deliveryCommandId, text)) ? "delivered" : "pending";
      } catch {
        delivery = "uncertain";
      }
      if (disposed()) return;
      repo.transaction(() => {
        const current = repo.get(task.id)!;
        const a = current.attempts.find((item) => item.sequence === attempt.sequence)!;
        if (
          a.deliveryOwner === owner &&
          a.delivery === "sending" &&
          a.sequence === attempt.sequence
        ) {
          a.delivery = delivery;
          repo.put(current);
        }
      });
    }
  }
}
