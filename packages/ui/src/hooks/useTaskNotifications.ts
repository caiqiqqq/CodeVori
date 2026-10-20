import { useEffect, useMemo, useRef, useState } from "react";
import type { IPlatformService, TaskNotificationPayload, WorkTaskScope } from "@zcode/shared";
import type { ConversationSnapshot, SessionSummary } from "@zcode/shared/zcode-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import type { IntlInstance } from "@/i18n/index.js";
import { logger } from "@/logger.js";
import {
  collectPendingInteractionNotificationPayloads,
  collectTerminalTaskNotificationPayloads,
} from "@/lib/taskNotificationOrchestrator.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";
import type { SessionsIndexStoreStatus } from "@/v4/sessionsIndexStore.js";
import { getWorkTaskReadModel } from "./workTaskReadModel.js";
import { isWorkTaskNotificationSession } from "@/lib/workTaskNotifications.js";
import type { BotTaskNotificationSender } from "./useBotTaskNotifier.js";

type FormatMessage = IntlInstance["formatMessage"];
type TaskNotificationPlatform = Pick<IPlatformService, "showTaskNotification">;

interface WorkspaceTerminalTaskNotificationsParams {
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string | null;
  enabled: boolean;
  rpcReady: boolean;
  platform: TaskNotificationPlatform | null | undefined;
  formatMessage: FormatMessage;
  botNotifier?: BotTaskNotificationSender;
  workTaskScope?: WorkTaskScope;
}

interface PendingInteractionTaskNotificationsParams {
  snapshot: ConversationSnapshot | null;
  enabled: boolean;
  platform: TaskNotificationPlatform | null | undefined;
  formatMessage: FormatMessage;
}

interface SessionsIndexNotificationState {
  signature: string;
  sessions: readonly SessionSummary[];
  status: SessionsIndexStoreStatus;
  baselineRevision: number;
}

function trimOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildWorkspaceNotificationSignature(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string;
}): string {
  return [
    params.endpointKey ?? "__base__",
    params.workspaceIdentity ?? "",
    params.workspacePath,
  ].join("\0");
}

function toSessionMap(sessions: readonly SessionSummary[]): Map<string, SessionSummary> {
  return new Map(sessions.map((session) => [session.sessionId, session]));
}

function showTaskNotification(
  platform: TaskNotificationPlatform,
  payload: TaskNotificationPayload,
): void {
  try {
    platform.showTaskNotification(payload);
  } catch (error) {
    logger.warn("[task-notification] 触发平台通知失败", {
      taskId: payload.taskId,
      status: payload.status,
      error,
    });
  }
}

/**
 * v4 任务终态通知编排。
 *
 * v4 重构删掉旧 renderer background monitor 后，platform 通知通道仍在，
 * 但 sessions-index 事实没有再被翻译成展示命令，导致任务完成/失败没有系统通知。
 * 这里只在 renderer 做“已观察边沿”的通知意图，事实仍以 sessions-index 为准；
 * 是否因窗口活跃而抑制通知继续交给 desktop/web platform 层判断。
 */
export function useWorkspaceTerminalTaskNotifications({
  workspacePath,
  workspaceIdentity: rawWorkspaceIdentity,
  endpointKey: rawEndpointKey,
  enabled,
  rpcReady,
  platform,
  formatMessage,
  botNotifier,
  workTaskScope,
}: WorkspaceTerminalTaskNotificationsParams): void {
  const { zcodeAgentService, workTaskService } = useServices();
  const workspaceIdentity = trimOptional(rawWorkspaceIdentity);
  const endpointKey = trimOptional(rawEndpointKey);
  const workspaceKey = workspaceIdentity ?? workspacePath;
  const taskWorkspacePath = workTaskScope?.workspacePath ?? workspacePath;
  const taskWorkspaceIdentity = workTaskScope ? workTaskScope.workspaceIdentity : workspaceIdentity;
  const taskRemoteSessionId = workTaskScope ? workTaskScope.remoteSessionId : endpointKey;
  const workTasks = useMemo(
    () =>
      workTaskService
        ? getWorkTaskReadModel(
            workTaskService,
            {
              workspacePath: taskWorkspacePath,
              workspaceIdentity: taskWorkspaceIdentity,
              remoteSessionId: taskRemoteSessionId,
            },
            false,
          )
        : null,
    [workTaskService, taskWorkspacePath, taskWorkspaceIdentity, taskRemoteSessionId],
  );
  // 机器人观察器也独立保留原共享读取，不能依赖当前页面恰好挂载待办看板。
  useEffect(() => {
    if (botNotifier && rpcReady) return workTasks?.subscribe(() => {});
  }, [botNotifier, rpcReady, workTasks]);
  const signature = useMemo(
    () =>
      buildWorkspaceNotificationSignature({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(endpointKey ? { endpointKey } : {}),
      }),
    [endpointKey, workspaceIdentity, workspacePath],
  );
  const [indexState, setIndexState] = useState<SessionsIndexNotificationState>({
    signature,
    sessions: [],
    status: "idle",
    baselineRevision: 0,
  });
  const previousBySessionIdRef = useRef<Map<string, SessionSummary> | null>(null);
  const baselineRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    previousBySessionIdRef.current = null;
    baselineRevisionRef.current = null;
    setIndexState({ signature, sessions: [], status: "idle", baselineRevision: 0 });
  }, [signature]);

  useEffect(() => {
    if ((!enabled && !botNotifier) || !rpcReady || (!platform && !botNotifier)) {
      // App 壳在 remote attachment 就绪前会先挂载，旧通知 hook
      // 只看用户开关就订阅 sessions-index，从而越过 conversation 的 readiness gate
      // 访问断连代理。这里共用 workspace rpcReady；本地 workspace 始终为 true。
      previousBySessionIdRef.current = null;
      setIndexState({ signature, sessions: [], status: "idle", baselineRevision: 0 });
      return;
    }

    const registryScope: SessionsIndexScope = {
      workspaceKey,
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(endpointKey ? { endpointKey } : {}),
    };
    const store = acquireSessionsIndex(registryScope, zcodeAgentService);
    const syncState = () => {
      setIndexState({
        signature,
        sessions: store.getSessions(),
        status: store.getStatus(),
        baselineRevision: store.getNotificationBaselineRevision(),
      });
    };
    const unsubscribe = store.subscribe(syncState);
    syncState();

    return () => {
      unsubscribe();
      releaseSessionsIndex(registryScope, store);
    };
  }, [
    enabled,
    botNotifier,
    endpointKey,
    platform,
    rpcReady,
    signature,
    workspaceIdentity,
    workspaceKey,
    workspacePath,
    zcodeAgentService,
  ]);

  useEffect(() => {
    if (indexState.status !== "live") {
      previousBySessionIdRef.current = null;
      baselineRevisionRef.current = null;
      return;
    }
    if (
      (!enabled && !botNotifier) ||
      (!platform && !botNotifier) ||
      indexState.signature !== signature ||
      indexState.status !== "live"
    ) {
      return;
    }

    const previousBySessionId = previousBySessionIdRef.current;
    const nextBySessionId = toSessionMap(indexState.sessions);
    if (!previousBySessionId || baselineRevisionRef.current !== indexState.baselineRevision) {
      baselineRevisionRef.current = indexState.baselineRevision;
      previousBySessionIdRef.current = nextBySessionId;
      return;
    }

    const payloads = collectTerminalTaskNotificationPayloads({
      previousBySessionId,
      // 修复依据：待办的终态由 task 投影通知；同目录原生会话不能再重复发送一次。
      sessions: indexState.sessions.filter(
        (session) =>
          !isWorkTaskNotificationSession(
            workTasks?.getSnapshot().data?.tasks ?? [],
            "api",
            session.sessionId,
            workspacePath,
          ),
      ),
      formatMessage,
    });
    for (const payload of payloads) {
      if (enabled && platform) showTaskNotification(platform, payload);
      const session = nextBySessionId.get(payload.taskId);
      if (session)
        botNotifier?.({
          source: "api",
          taskId: payload.taskId,
          eventKey: String(session.lastActivityAt),
          status: payload.status === "failed" ? "failed" : "completed",
          title: payload.title,
          body: session.title,
        });
    }
    // 后台等待只读取列表的轻量 interaction 身份，不订阅问题、命令或完整对话。
    if (botNotifier)
      for (const session of indexState.sessions) {
        const request = session.pendingInteraction;
        const previous = previousBySessionId.get(session.sessionId);
        if (
          !previous ||
          !request ||
          previous.pendingInteraction?.interactionId === request.interactionId ||
          isWorkTaskNotificationSession(
            workTasks?.getSnapshot().data?.tasks ?? [],
            "api",
            session.sessionId,
            workspacePath,
          )
        )
          continue;
        botNotifier({
          source: "api",
          taskId: session.sessionId,
          eventKey: request.interactionId,
          status: "awaiting_input",
          title: formatMessage({
            id:
              request.kind === "permission"
                ? "notification.permissionRequired"
                : "notification.inputRequired",
          }),
          body: session.title,
        });
      }
    previousBySessionIdRef.current = nextBySessionId;
  }, [
    enabled,
    botNotifier,
    formatMessage,
    indexState,
    platform,
    signature,
    workTasks,
    workspacePath,
  ]);
}

/**
 * 当前 conversation snapshot 的阻塞交互通知。
 *
 * 首个 snapshot 只作为基线，避免订阅历史/恢复 replayable snapshot 时重放旧权限弹窗通知；
 * 后续新增 interactionId 才发通知，重复 pending 不会刷屏。
 */
export function usePendingInteractionTaskNotifications({
  snapshot,
  enabled,
  platform,
  formatMessage,
}: PendingInteractionTaskNotificationsParams): void {
  const seenRef = useRef<{ sessionId: string; seenRequestIds: Set<string> } | null>(null);

  useEffect(() => {
    if (!enabled || !snapshot) {
      seenRef.current = null;
      return;
    }

    const currentRequestIds = snapshot.pendingInteractions.map(
      (interaction) => interaction.interactionId,
    );
    const currentSeen = seenRef.current;
    if (!currentSeen || currentSeen.sessionId !== snapshot.sessionId) {
      seenRef.current = {
        sessionId: snapshot.sessionId,
        seenRequestIds: new Set(currentRequestIds),
      };
      return;
    }

    if (platform) {
      const payloads = collectPendingInteractionNotificationPayloads({
        snapshot,
        seenRequestIds: currentSeen.seenRequestIds,
        formatMessage,
      });
      for (const payload of payloads) {
        showTaskNotification(platform, payload);
      }
    }

    for (const requestId of currentRequestIds) {
      currentSeen.seenRequestIds.add(requestId);
    }
  }, [enabled, formatMessage, platform, snapshot]);
}
