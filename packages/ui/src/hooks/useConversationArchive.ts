import { useEffect, useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

/** Native archive metadata is observed from its Host owner, never from the composer draft. */
export function useConversationArchive(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
) {
  const { zcodeTaskService } = useServices();
  const targetKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId]);
  const [value, setValue] = useState<{ key: string; blocked: boolean; pending: boolean }>({
    key: "",
    blocked: false,
    pending: false,
  });
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    let serial = 0;
    const target = { workspacePath, workspaceIdentity, taskId: sessionId };
    const read = async () => {
      const request = ++serial;
      try {
        const meta = await zcodeTaskService.getTaskMeta(target);
        // membership 的归档字段由 list endpoint 持有；读取归档集合只读 index，不启动 Agent。
        const archives = await zcodeTaskService.listArchivedTasks(target);
        if (live && serial === request)
          setValue({
            key: targetKey,
            pending: Boolean(meta?.deletionState),
            blocked: Boolean(
              meta?.deletionState || archives.some((task) => task.taskId === sessionId),
            ),
          });
      } catch (error) {
        if (live) logger.warn("[archive] 读取会话归档状态失败", { error });
      }
    };
    const subscription = zcodeTaskService.onDynamicWorkspaceEvent(target)((event) => {
      if (
        event.type === "workspace_task_list_changed" &&
        (!event.taskId || event.taskId === sessionId)
      )
        void read();
    });
    void read();
    return () => {
      live = false;
      subscription.dispose();
    };
  }, [sessionId, targetKey, workspaceIdentity, workspacePath, zcodeTaskService]);
  return value.key !== targetKey || !value.blocked
    ? "active"
    : value.pending
      ? "pending"
      : "archived";
}
