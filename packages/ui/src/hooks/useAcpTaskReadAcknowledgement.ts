import { useEffect, useRef } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { logger } from "@/logger.js";

type ReadTarget = Pick<
  AcpSidebarSession,
  "id" | "workspacePath" | "workspaceIdentity" | "remoteSessionId" | "status" | "unreadAt"
>;

/** 确认焦点窗格观察到的结果；侧栏折叠不影响已读，接受的状态仍归目标 Host。 */
export function useAcpTaskReadAcknowledgement(
  session: ReadTarget | null,
  service: IAcpService,
  active: boolean,
  readOnly: boolean,
) {
  const readScope = JSON.stringify([
    session?.workspaceIdentity?.trim() || session?.workspacePath,
    session?.workspacePath,
    session?.remoteSessionId,
    session?.id,
  ]);
  const lastReadObservation = useRef<{
    scope: string;
    service: typeof service;
    active: boolean;
    status: ReadTarget["status"];
  } | null>(null);
  useEffect(() => {
    if (!session) {
      lastReadObservation.current = null;
      return;
    }
    const previous = lastReadObservation.current;
    lastReadObservation.current = { scope: readScope, service, active, status: session.status };
    const opened =
      !previous || previous.scope !== readScope || previous.service !== service || !previous.active;
    const finished = previous?.status === "running" && session.status !== "running";
    if (!active || readOnly || typeof session.unreadAt !== "number" || (!opened && !finished))
      return;
    // 修复原因：正在查看的 ACP 回合结束也会收到 Host 未读；只在打开或终态边沿确认已读，
    // 不因普通 revision/手动标记未读而反复清除。结果以 Host 广播为准，不复制 renderer 状态。
    void service
      .updateRow({
        id: session.id,
        workspacePath: session.workspacePath,
        workspaceIdentity: session.workspaceIdentity,
        remoteSessionId: session.remoteSessionId,
        action: { kind: "unread", unread: false, expectedUnreadAt: session.unreadAt },
      })
      .catch((error: unknown) => logger.warn("[acp-sidebar] 确认当前会话已读失败", { error }));
  }, [
    active,
    readOnly,
    readScope,
    service,
    session?.id,
    session?.remoteSessionId,
    session?.status,
    session?.unreadAt,
    session?.workspaceIdentity,
    session?.workspacePath,
  ]);
}
