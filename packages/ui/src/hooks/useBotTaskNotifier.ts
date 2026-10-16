import { useCallback } from "react";
import type { BotTaskNotification, WorkTaskScope } from "@zcode/shared";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

export type BotTaskNotificationSender = (
  event: Omit<BotTaskNotification, "workspacePath" | "workspaceIdentity" | "remoteSessionId">,
) => void;

/** 通知使用窗口基础 Host 的机器人配置；远端事实仍由原 scoped service 提供。 */
export function useBotTaskNotifier(scope: WorkTaskScope): BotTaskNotificationSender | undefined {
  const services = useOptionalBaseWorkspaceServices();
  const service = services?.botsService;
  const { workspacePath, workspaceIdentity, remoteSessionId } = scope;
  const send = useCallback<BotTaskNotificationSender>(
    (event) => {
      if (!service) return;
      void service
        .notifyTask({
          ...event,
          workspacePath,
          ...(workspaceIdentity?.trim() ? { workspaceIdentity: workspaceIdentity.trim() } : {}),
          ...(remoteSessionId?.trim() ? { remoteSessionId: remoteSessionId.trim() } : {}),
          title: event.title.slice(0, 512),
          body: event.body.slice(0, 2048),
        })
        .catch(() => logger.warn("[bot-task-notification] 发送通知命令失败"));
    },
    [service, workspacePath, workspaceIdentity, remoteSessionId],
  );
  return service ? send : undefined;
}
