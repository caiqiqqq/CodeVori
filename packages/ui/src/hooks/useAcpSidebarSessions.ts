import { useCallback, useEffect, useMemo, useState } from "react";
import type { AcpSession } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { projectAcpSidebarSessions, type AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { logger } from "@/logger.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

function sameSidebarRows(
  left: readonly AcpSidebarSession[] | undefined,
  right: readonly AcpSidebarSession[],
) {
  return (
    left?.length === right.length &&
    right.every((row, index) => {
      const previous = left[index];
      return (
        previous?.id === row.id &&
        previous.title === row.title &&
        previous.pinned === row.pinned &&
        previous.archived === row.archived &&
        previous.deletionState === row.deletionState &&
        previous.unreadAt === row.unreadAt &&
        previous.status === row.status &&
        previous.failed === row.failed &&
        previous.waiting === row.waiting &&
        previous.boardCompletedAt === row.boardCompletedAt &&
        previous.preview === row.preview &&
        previous.createdAt === row.createdAt &&
        previous.updatedAt === row.updatedAt
      );
    })
  );
}

/** Sidebar observes each resolved target Host; it owns no accepted ACP state. */
export function useAcpSidebarSessionState(
  workspaceTabs: Pick<WorkspaceTabState, "workspacePath" | "workspaceIdentity">[],
  serviceLookup: Map<string, { services: IServiceAccessor; remoteSessionId?: string }>,
  retainDisconnected = false,
) {
  const [byWorkspace, setByWorkspace] = useState<Record<string, AcpSidebarSession[]>>({});
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((value) => value + 1), []);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const targets = useMemo(() => {
    const unique = new Map<
      string,
      {
        workspacePath: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
        services: IServiceAccessor;
      }
    >();
    for (const tab of workspaceTabs) {
      const key = buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity);
      const resolved = serviceLookup.get(key);
      if (!resolved) continue;
      unique.set(key, {
        workspacePath: tab.workspacePath,
        ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
        ...(resolved.remoteSessionId ? { remoteSessionId: resolved.remoteSessionId } : {}),
        services: resolved.services,
      });
    }
    return unique;
  }, [serviceLookup, workspaceTabs]);

  useEffect(() => {
    let live = true;
    // 看板保留断连目标的最后可信行；原侧栏保持切换目标时重新读取的行为。
    if (!retainDisconnected) setByWorkspace({});
    else {
      const keys = new Set(
        workspaceTabs.map((tab) => buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity)),
      );
      setByWorkspace((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key))),
      );
    }
    setPending(targets.size);
    setError(null);
    const subscriptions = [...targets].map(([key, { services, ...workspace }]) => {
      const snapshots = new Map<string, AcpSession>();
      const removed = new Set<string>();
      const publish = () => {
        if (!live) return;
        const rows = projectAcpSidebarSessions([...snapshots.values()], workspace);
        // 流式文本 chunk 更新 Host revision，但标题/状态/行时间没变时不重绘整棵任务列表。
        setByWorkspace((previous) =>
          sameSidebarRows(previous[key], rows) ? previous : { ...previous, [key]: rows },
        );
      };
      // 修复原因：先订阅再 list，首发 admission 与历史读取并发时按 revision 合并，
      // 删除事件也不能被迟到的旧 list 快照重新列回侧栏。
      const subscription = services.acpService.onDynamicSessionSummaryChanged(workspace)(
        (change) => {
          if (!live) return;
          if (change.kind === "removed") {
            removed.add(change.id);
            snapshots.delete(change.id);
          } else {
            // 同一 Host id 不会被重用；删除后的迟到 revision 不能复活侧栏记录。
            if (removed.has(change.session.id)) return;
            const previous = snapshots.get(change.session.id);
            if (!previous || previous.revision <= change.session.revision)
              snapshots.set(change.session.id, change.session);
          }
          publish();
        },
      );
      void services.acpService
        .listSummaries(workspace)
        .then((items) => {
          if (!live) return;
          for (const item of items) {
            const previous = snapshots.get(item.id);
            if (!removed.has(item.id) && (!previous || previous.revision < item.revision))
              snapshots.set(item.id, item);
          }
          publish();
        })
        .catch((error: unknown) => {
          if (live) {
            setError(error);
            logger.warn("[acp-sidebar] 读取智能体会话失败", { error });
          }
        })
        .finally(() => {
          if (live) setPending((count) => Math.max(0, count - 1));
        });
      return subscription;
    });
    return () => {
      live = false;
      subscriptions.forEach((subscription) => subscription.dispose());
    };
  }, [targets, retry, retainDisconnected, workspaceTabs]);

  const rows = useMemo(() => {
    const keys = new Set(
      workspaceTabs.map((tab) => buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity)),
    );
    return Object.entries(byWorkspace).flatMap(([key, rows]) => (keys.has(key) ? rows : []));
  }, [byWorkspace, workspaceTabs]);
  return { rows, loading: pending > 0, error, refresh };
}

export function useAcpSidebarSessions(
  ...args: Parameters<typeof useAcpSidebarSessionState>
): AcpSidebarSession[] {
  return useAcpSidebarSessionState(...args).rows;
}
