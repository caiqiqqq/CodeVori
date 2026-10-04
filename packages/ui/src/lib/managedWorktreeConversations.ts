import type { IServiceAccessor } from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { projectAcpSidebarSessions, type AcpSidebarSession } from "@/lib/acpSidebarSessions.js";

export type ManagedWorktreeConversation =
  | { kind: "api"; id: string; title: string; updatedAt: number; task: ZCodeTaskMeta }
  | { kind: "acp"; id: string; title: string; updatedAt: number; session: AcpSidebarSession };

export async function loadManagedWorktreeConversations(
  services: Pick<IServiceAccessor, "zcodeTaskService" | "acpService">,
  workspacePath: string,
): Promise<{ conversations: ManagedWorktreeConversation[]; failed: boolean }> {
  const target = { workspacePath };
  // API 普通/置顶/归档列表彼此独立，ACP 历史属于另一个 Host；并行读取后按 id 去重。
  const results = await Promise.allSettled([
    services.zcodeTaskService.listTasks(target),
    services.zcodeTaskService.listPinnedTasks(target),
    services.zcodeTaskService.listArchivedTasks(target),
    services.acpService.list(target),
  ] as const);
  const tasks = new Map<string, ZCodeTaskMeta>();
  for (const result of results.slice(0, 3)) {
    if (result.status !== "fulfilled") continue;
    for (const task of result.value as ZCodeTaskMeta[]) tasks.set(task.taskId, task);
  }
  const native: ManagedWorktreeConversation[] = [...tasks.values()].map((task) => ({
    kind: "api",
    id: task.taskId,
    title: task.title,
    updatedAt: task.updatedAt,
    task,
  }));
  const acp: ManagedWorktreeConversation[] =
    results[3].status === "fulfilled"
      ? projectAcpSidebarSessions(results[3].value, target).map((session) => ({
          kind: "acp",
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          session,
        }))
      : [];
  return {
    conversations: [...native, ...acp].sort((a, b) => b.updatedAt - a.updatedAt),
    failed: results.some((result) => result.status === "rejected"),
  };
}
