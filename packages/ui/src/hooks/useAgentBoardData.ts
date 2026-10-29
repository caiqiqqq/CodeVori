import { useAgentBoardWorkTasks } from "./useAgentBoardWorkTasks.js";
import { useCallback, useMemo } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useAcpSidebarSessionState } from "@/hooks/useAcpSidebarSessions.js";
import { useWorktreeProjectGroups } from "@/hooks/useWorktreeProjectGroups.js";
import { buildWorkspaceServiceLookup } from "@/lib/workspaceServiceResolver.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  boardEntityKey,
  compareBoardItems,
  boardWorkspaceKey,
  nativeBoardStatus,
  acpBoardStatus,
  workTaskBoardStatus,
  type BoardItem,
} from "@/agent-board/agentBoardModel.js";

export function useAgentBoardProjects(workspaceTabs: WorkspaceTabState[]) {
  const groups = useWorktreeProjectGroups(workspaceTabs);
  const { intl } = useZCodeIntl();
  return useMemo(
    () =>
      groups.map((group) => ({
        key: boardWorkspaceKey(group.tab),
        // 无项目会话的目录只是运行 cwd，不能把内部目录名当作用户项目展示。
        label:
          group.tab.workspacePurpose === "conversation"
            ? intl.formatMessage({ id: "agentBoard.conversations" })
            : group.tab.label,
        tabs: group.workspaceTabs,
      })),
    [groups, intl],
  );
}
export type BoardAction = "archive";
export function useAgentBoardData(workspaceTabs: WorkspaceTabState[]) {
  const services = useBaseWorkspaceServices();
  const sessionsById = useRemoteWorkspaceSessionStore((s) => s.sessionsById);
  const sessionIdByWorkspaceIdentity = useRemoteWorkspaceSessionStore(
    (s) => s.sessionIdByWorkspaceIdentity,
  );
  const sessionIdByWorkspacePath = useRemoteWorkspaceSessionStore(
    (s) => s.sessionIdByWorkspacePath,
  );
  const lookup = useMemo(
    () =>
      buildWorkspaceServiceLookup(workspaceTabs, services, {
        sessionsById,
        sessionIdByWorkspaceIdentity,
        sessionIdByWorkspacePath,
      }),
    [workspaceTabs, services, sessionsById, sessionIdByWorkspaceIdentity, sessionIdByWorkspacePath],
  );
  const projects = useAgentBoardProjects(workspaceTabs);
  const workTasks = useAgentBoardWorkTasks(workspaceTabs);
  const query = {
    workspaceTabs,
    sortBy: "updated" as const,
    searchQuery: "",
    expanded: true,
    collapsedLimit: 20,
  };
  const timeline = useGlobalTaskList({ ...query, kind: "timeline" });
  const pinned = useGlobalTaskList({ ...query, kind: "pinned" });
  const archived = useGlobalTaskList({ ...query, kind: "archived" });
  const acp = useAcpSidebarSessionState(workspaceTabs, lookup, true);
  const items = useMemo(() => {
    const projectByScope = new Map(
      projects.flatMap((project) =>
        project.tabs.map((tab) => [boardWorkspaceKey(tab), project.key] as const),
      ),
    );
    const tabByScope = new Map(workspaceTabs.map((tab) => [boardWorkspaceKey(tab), tab]));
    const rows = new Map<string, BoardItem>();
    // 原收藏会话仍属于全部列表；仅移除看板收藏操作，不能遗漏 pinned 来源的成员。
    for (const [list, isArchived] of [
      [timeline.items, false],
      [pinned.items, false],
      [archived.items, true],
    ] as const) {
      for (const task of list) {
        if (task.deletionState) continue;
        const scope = boardWorkspaceKey(task);
        const key = boardEntityKey(task, "native", task.taskId);
        rows.set(key, {
          kind: "native",
          task,
          key,
          projectKey: projectByScope.get(scope) ?? scope,
          title: task.title,
          workspacePath: task.workspacePath,
          workspaceIdentity: task.workspaceIdentity,
          workspacePurpose: tabByScope.get(scope)?.workspacePurpose,
          remoteSessionId: task.remoteSessionId,
          updatedAt: task.updatedAt,
          completedAt: task.activity?.lastActivityAt,
          agent: task.provider || "API",
          status: nativeBoardStatus(task),
          archived: isArchived,
          online:
            task.sourceAvailability === "online" &&
            lookup.has(scope) &&
            tabByScope.get(scope)?.availability !== "unavailable-local-directory",
        });
      }
    }
    for (const session of acp.rows) {
      if (session.deletionState) continue;
      const scope = boardWorkspaceKey(session);
      const key = boardEntityKey(session, "acp", session.id);
      rows.set(key, {
        kind: "acp",
        session: { ...session, remoteSessionId: lookup.get(scope)?.remoteSessionId },
        key,
        projectKey: projectByScope.get(scope) ?? scope,
        title: session.title,
        workspacePath: session.workspacePath,
        workspaceIdentity: session.workspaceIdentity,
        workspacePurpose: tabByScope.get(scope)?.workspacePurpose,
        remoteSessionId: lookup.get(scope)?.remoteSessionId,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt,
        agent: session.agent,
        status: acpBoardStatus(session),
        archived: Boolean(session.archived),
        online:
          lookup.has(scope) &&
          tabByScope.get(scope)?.availability !== "unavailable-local-directory",
        // 最近用户消息不是任务摘要；不再在卡片重复展示或作为看板搜索内容。
      });
    }
    for (const workTask of workTasks.board?.tasks ?? []) {
      const scope = boardWorkspaceKey(workTask);
      const key = boardEntityKey(workTask, "work-task", workTask.id);
      rows.set(key, {
        kind: "work-task",
        workTask,
        key,
        projectKey: projectByScope.get(scope) ?? scope,
        title: workTask.title,
        workspacePath: workTask.workspacePath,
        workspaceIdentity: workTask.workspaceIdentity,
        remoteSessionId: workTask.remoteSessionId,
        updatedAt: workTask.updatedAt,
        completedAt: workTask.finishedAt,
        agent:
          workTask.execution.kind === "acp"
            ? workTask.execution.agent
            : workTask.execution.modelSelection.modelId,
        status: workTaskBoardStatus(workTask),
        archived: workTask.archived,
        online:
          lookup.has(scope) &&
          tabByScope.get(scope)?.availability !== "unavailable-local-directory",
        summary: workTask.failureReason,
      });
    }
    return [...rows.values()].sort(compareBoardItems);
  }, [
    projects,
    workspaceTabs,
    timeline.items,
    pinned.items,
    archived.items,
    acp.rows,
    lookup,
    workTasks.board,
  ]);
  const refresh = useCallback(async () => {
    acp.refresh();
    await Promise.all([
      timeline.refresh(),
      pinned.refresh(),
      archived.refresh(),
      workTasks.refresh(),
    ]);
  }, [timeline.refresh, pinned.refresh, archived.refresh, acp.refresh, workTasks.refresh]);
  const mutate = useCallback(
    async (item: BoardItem, action: BoardAction) => {
      if (item.kind === "work-task") throw new Error("Use WorkTask lifecycle commands");
      if (!item.online) throw new Error("Workspace unavailable");
      if (!item.archived && (item.status === "running" || item.status === "waiting"))
        throw new Error("Session is active");
      if (item.kind === "native") {
        if (!services.windowControllerService) throw new Error("Window Controller unavailable");
        await services.windowControllerService.mutateTask({
          address: {
            taskId: item.task.taskId,
            workspacePath: item.workspacePath,
            ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
            ...(item.remoteSessionId ? { remoteSessionId: item.remoteSessionId } : {}),
          },
          mutation: { kind: action, archived: !item.archived },
        });
        await refresh();
      } else {
        const target = lookup.get(boardWorkspaceKey(item));
        if (!target) throw new Error("Workspace unavailable");
        await target.services.acpService.updateRow({
          id: item.session.id,
          workspacePath: item.workspacePath,
          workspaceIdentity: item.workspaceIdentity,
          remoteSessionId: target.remoteSessionId,
          action: { kind: action, archived: !item.archived },
        });
      }
    },
    [services, lookup, refresh],
  );
  const acknowledgeRead = useCallback(
    async (item: BoardItem) => {
      if (item.kind === "work-task" || !item.online || item.archived) return;
      const unreadAt = item.kind === "native" ? item.task.unreadAt : item.session.unreadAt;
      if (typeof unreadAt !== "number") return;
      if (item.kind === "native") {
        if (!services.windowControllerService) throw new Error("Window Controller unavailable");
        await services.windowControllerService.mutateTask({
          address: {
            taskId: item.task.taskId,
            workspacePath: item.workspacePath,
            ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
            ...(item.remoteSessionId ? { remoteSessionId: item.remoteSessionId } : {}),
          },
          mutation: { kind: "mark-read", expectedUnreadAt: unreadAt },
        });
        await refresh();
      } else {
        const target = lookup.get(boardWorkspaceKey(item));
        if (!target) throw new Error("Workspace unavailable");
        await target.services.acpService.updateRow({
          id: item.session.id,
          workspacePath: item.workspacePath,
          workspaceIdentity: item.workspaceIdentity,
          remoteSessionId: target.remoteSessionId,
          action: { kind: "unread", unread: false, expectedUnreadAt: unreadAt },
        });
      }
    },
    [services.windowControllerService, lookup, refresh],
  );
  return {
    projects,
    workTasks,
    canCreateSession: (tab: WorkspaceTabState) =>
      lookup.has(boardWorkspaceKey(tab)) && tab.availability !== "unavailable-local-directory",
    items,
    mutate,
    acknowledgeRead,
    refresh,
    loading:
      timeline.loading || pinned.loading || archived.loading || acp.loading || workTasks.loading,
    error: timeline.error || pinned.error || archived.error || acp.error || workTasks.error,
  };
}
