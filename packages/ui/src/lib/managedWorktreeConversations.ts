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
  // 工作树列表只展示未归档会话：API 普通/置顶分区已排除归档，ACP 历史需按 Host 的归档状态过滤。
  const [ordinaryResult, pinnedResult, acpResult] = await Promise.allSettled([
    services.zcodeTaskService.listTasks(target),
    services.zcodeTaskService.listPinnedTasks(target),
    services.acpService.list(target),
  ] as const);
  const tasks = new Map<string, ZCodeTaskMeta>();
  for (const result of [ordinaryResult, pinnedResult]) {
    if (result.status !== "fulfilled") continue;
    for (const task of result.value) tasks.set(task.taskId, task);
  }
  const native: ManagedWorktreeConversation[] = [...tasks.values()].map((task) => ({
    kind: "api",
    id: task.taskId,
    title: task.title,
    updatedAt: task.updatedAt,
    task,
  }));
  const acp: ManagedWorktreeConversation[] =
    acpResult.status === "fulfilled"
      ? projectAcpSidebarSessions(acpResult.value, target)
          .filter((session) => !session.archived)
          .map((session) => ({
            kind: "acp",
            id: session.id,
            title: session.title,
            updatedAt: session.updatedAt,
            session,
          }))
      : [];
  return {
    conversations: [...native, ...acp].sort((a, b) => b.updatedAt - a.updatedAt),
    failed: [ordinaryResult, pinnedResult, acpResult].some(
      (result) => result.status === "rejected",
    ),
  };
}
