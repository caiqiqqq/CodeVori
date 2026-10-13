import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import type { AcpSession, IPlatformService } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import type { IntlInstance } from "@/i18n/index.js";
import { logger } from "@/logger.js";
import { projectAcpSidebarSessions, type AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import {
  ACP_TASK_NOTIFICATION_PREFIX,
  getAcpTerminalTaskNotificationPayload,
  toAcpTaskNotificationState,
  type AcpTaskNotificationState,
} from "@/lib/taskNotificationOrchestrator.js";
import { requestWorktreeSettingsConversation } from "@/lib/worktreeSettingsNavigation.js";
import { getWorkTaskReadModel } from "./workTaskReadModel.js";
import { isWorkTaskNotificationSession } from "@/lib/workTaskNotifications.js";

/** ACP 完成事实独立于 API sessions-index，通知必须在 workspace 壳观察，不能绑定选中面板。 */
export function useAcpTaskNotifications({
  workspacePath,
  workspaceIdentity: rawIdentity,
  remoteSessionId,
  enabled,
  rpcReady,
  platform,
  formatMessage,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  enabled: boolean;
  rpcReady: boolean;
  platform: Pick<IPlatformService, "showTaskNotification" | "onTaskNotificationClick"> | null;
  formatMessage: IntlInstance["formatMessage"];
}): void {
  const { acpService, workTaskService } = useServices();
  const workspaceIdentity = rawIdentity?.trim() || undefined;
  const workspace = useMemo(
    () => ({ workspacePath, workspaceIdentity, remoteSessionId }),
    [workspacePath, workspaceIdentity, remoteSessionId],
  );
  const workTasks = useMemo(
    () => (workTaskService ? getWorkTaskReadModel(workTaskService, workspace, false) : null),
    [workTaskService, workspace],
  );
  const owner = useMemo(
    () => ({}),
    [workspace, acpService, enabled, rpcReady, platform, workTasks],
  );
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const payloadFor = useEffectEvent(
    (previous: AcpTaskNotificationState | undefined, next: AcpTaskNotificationState) =>
      getAcpTerminalTaskNotificationPayload(previous, next, formatMessage),
  );

  useEffect(() => {
    if (!enabled || !rpcReady || !platform) return;
    let live = true;
    const isCurrent = () => live && currentOwner.current === owner;
    const key = workspaceIdentity ?? workspacePath;
    const facts = new Map<string, AcpTaskNotificationState>();
    const removed = new Set<string>();
    const targets = new Map<string, AcpSidebarSession>();
    const matches = (session: AcpSession) =>
      session.workspacePath === workspacePath &&
      (session.workspaceIdentity?.trim() || session.workspacePath) === key;
    const observe = (session: AcpSession, baseline: boolean) => {
      if (!isCurrent() || !matches(session) || removed.has(session.id)) return;
      const previous = facts.get(session.id);
      if (previous && previous.revision >= session.revision) return;
      const next = toAcpTaskNotificationState(session);
      facts.set(session.id, next);
      if (session.archived || session.supersededBy) targets.delete(session.id);
      // 修复原因：初始/恢复快照只建立观察基线；系统通知只能来自已观察运行轮的实时终态边沿。
      const payload = baseline ? null : payloadFor(previous, next);
      if (!payload) return;
      // 修复依据：直接分支待办与普通会话同目录，终态提醒由窗口级待办观察器统一负责。
      if (
        isWorkTaskNotificationSession(
          workTasks?.getSnapshot().data?.tasks ?? [],
          "acp",
          session.id,
          workspacePath,
        )
      )
        return;
      const row = projectAcpSidebarSessions([session], workspace)[0];
      if (row) targets.set(session.id, row);
      try {
        platform.showTaskNotification(payload);
      } catch (error) {
        logger.warn("[acp-task-notification] 触发平台通知失败", { error });
      }
    };
    const subscription = acpService.onDynamicSessionSummaryChanged(workspace)((change) => {
      if (!isCurrent()) return;
      if (change.kind === "updated") {
        observe(change.session, false);
      } else if (change.workspacePath === workspacePath && change.workspaceKey === key) {
        removed.add(change.id);
        facts.delete(change.id);
        targets.delete(change.id);
      }
    });
    const disposeClick = platform.onTaskNotificationClick((id) => {
      if (!isCurrent() || !id.startsWith(ACP_TASK_NOTIFICATION_PREFIX)) return;
      const session = targets.get(id.slice(ACP_TASK_NOTIFICATION_PREFIX.length));
      if (session) requestWorktreeSettingsConversation({ kind: "acp", session });
    });
    // 先订阅再读取，迟到的 list 不覆盖实时 revision，也不会复活已删除会话。
    void acpService.listSummaries(workspace).then(
      (sessions) => sessions.forEach((session) => observe(session, true)),
      (error) => {
        if (isCurrent()) logger.warn("[acp-task-notification] 读取通知基线失败", { error });
      },
    );
    return () => {
      live = false;
      subscription.dispose();
      disposeClick();
    };
  }, [
    acpService,
    enabled,
    owner,
    platform,
    rpcReady,
    workspace,
    workspaceIdentity,
    workspacePath,
    workTasks,
  ]);
}
