import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import type { IWorkTaskService } from "@zcode/services";
import type { IPlatformService, WorkTaskScope } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/index.js";
import { logger } from "@/logger.js";
import {
  getWorkTaskAttentionNotification,
  toWorkTaskNotificationFact,
  type WorkTaskNotificationFact,
} from "@/lib/workTaskNotifications.js";
import { requestWorktreeSettingsConversation } from "@/lib/worktreeSettingsNavigation.js";
import { columnForWorkTaskStatus } from "@/lib/workTaskBoard.js";
import { getWorkTaskReadModel } from "./workTaskReadModel.js";

/** 后台待办不会挂载交互弹窗；等待通知必须观察原 Host task 投影，而非当前选中对话。 */
export function useWorkTaskNotifications({
  service,
  scope: input,
  enabled,
  platform,
  formatMessage,
}: {
  service: IWorkTaskService | undefined;
  scope: WorkTaskScope;
  enabled: boolean;
  platform: Pick<IPlatformService, "showTaskNotification" | "onTaskNotificationClick"> | null;
  formatMessage: IntlInstance["formatMessage"];
}): void {
  const scope = useMemo(
    () => ({
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity?.trim() || undefined,
      remoteSessionId: input.remoteSessionId?.trim() || undefined,
    }),
    [input.workspacePath, input.workspaceIdentity, input.remoteSessionId],
  );
  const owner = useMemo(() => ({}), [service, scope, enabled, platform]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const payloadFor = useEffectEvent(
    (
      previous: WorkTaskNotificationFact | undefined,
      task: Parameters<typeof getWorkTaskAttentionNotification>[1],
    ) => getWorkTaskAttentionNotification(previous, task, scope, formatMessage),
  );

  useEffect(() => {
    if (!enabled || !service || !platform) return;
    let live = true;
    const isCurrent = () => live && currentOwner.current === owner;
    const resource = getWorkTaskReadModel(service, scope, false);
    let previous: Map<string, WorkTaskNotificationFact> | null = null;
    let lastData: ReturnType<typeof resource.getSnapshot>["data"] = null;
    const targets = new Map<string, { id: string; runSeq: number }>();
    const observe = () => {
      if (!isCurrent()) return;
      const { data, error, loading } = resource.getSnapshot();
      if (error) {
        previous = null;
        targets.clear();
        return;
      }
      if (!data || loading || data === lastData) return;
      lastData = data;
      const next = new Map<string, WorkTaskNotificationFact>();
      for (const task of data.tasks) {
        const fact = toWorkTaskNotificationFact(task);
        next.set(task.id, fact);
        // 首个成功快照及恢复读取只建立基线；共享读取负责丢弃旧 RPC，不能补发历史等待。
        const payload = previous ? payloadFor(previous.get(task.id), task) : null;
        if (!payload) continue;
        targets.set(payload.taskId, { id: task.id, runSeq: task.runSeq });
        try {
          platform.showTaskNotification(payload);
        } catch (error) {
          logger.warn("[work-task-notification] 触发平台通知失败", { error });
        }
      }
      for (const [id, target] of targets) {
        const fact = next.get(target.id);
        if (
          !fact ||
          fact.runSeq !== target.runSeq ||
          columnForWorkTaskStatus(fact.status) !== "attention" ||
          fact.archived ||
          fact.stopPending
        )
          targets.delete(id);
      }
      previous = next;
    };
    const unsubscribe = resource.subscribe(observe);
    observe();
    const disposeClick = platform.onTaskNotificationClick((id) => {
      if (!isCurrent()) return;
      const target = targets.get(id);
      if (target) requestWorktreeSettingsConversation({ kind: "work-task", scope, id: target.id });
    });
    return () => {
      live = false;
      unsubscribe();
      disposeClick();
    };
  }, [enabled, owner, platform, scope, service]);
}
