import { useEffect, useMemo, useState } from "react";
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
        previous.unreadAt === row.unreadAt &&
        previous.status === row.status &&
        previous.createdAt === row.createdAt &&
        previous.updatedAt === row.updatedAt
      );
    })
  );
}

/** Sidebar observes each resolved target Host; it owns no accepted ACP state. */
export function useAcpSidebarSessions(
  workspaceTabs: WorkspaceTabState[],
  serviceLookup: Map<string, { services: IServiceAccessor; remoteSessionId?: string }>,
): AcpSidebarSession[] {
  const [byWorkspace, setByWorkspace] = useState<Record<string, AcpSidebarSession[]>>({});
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
    setByWorkspace({});
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
      const subscription = services.acpService.onDynamicSessionChanged(workspace)((change) => {
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
      });
      void services.acpService
        .list(workspace)
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
          if (live) logger.warn("[acp-sidebar] 读取智能体会话失败", { error });
        });
      return subscription;
    });
    return () => {
      live = false;
      subscriptions.forEach((subscription) => subscription.dispose());
    };
  }, [targets]);

  return useMemo(() => Object.values(byWorkspace).flat(), [byWorkspace]);
}
