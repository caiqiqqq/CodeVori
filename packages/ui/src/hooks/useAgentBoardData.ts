import { useCallback, useMemo } from "react";
import type { WindowHostControllerMutation } from "@zcode/services";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useAcpSidebarSessionState } from "@/hooks/useAcpSidebarSessions.js";
import { useWorktreeProjectGroups } from "@/hooks/useWorktreeProjectGroups.js";
import { buildWorkspaceServiceLookup } from "@/lib/workspaceServiceResolver.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  boardEntityKey,
  boardWorkspaceKey,
  nativeBoardStatus,
  acpBoardStatus,
  type BoardItem,
} from "@/agent-board/agentBoardModel.js";

export function useAgentBoardProjects(workspaceTabs: WorkspaceTabState[]) {
  const groups = useWorktreeProjectGroups(workspaceTabs);
  return useMemo(
    () =>
      groups.map((group) => ({
        key: boardWorkspaceKey(group.tab),
        label: group.tab.label,
        tabs: group.workspaceTabs,
      })),
    [groups],
  );
}
export type BoardAction = "pin" | "archive" | "completion";
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
    for (const [list, isPinned, isArchived] of [
      [timeline.items, false, false],
      [pinned.items, true, false],
      [archived.items, false, true],
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
          remoteSessionId: task.remoteSessionId,
          updatedAt: task.updatedAt,
          agent: task.provider || "API",
          status: nativeBoardStatus(task),
          pinned: isPinned,
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
        remoteSessionId: lookup.get(scope)?.remoteSessionId,
        updatedAt: session.updatedAt,
        agent: session.agent,
        status: acpBoardStatus(session),
        pinned: Boolean(session.pinned),
        archived: Boolean(session.archived),
        online:
          lookup.has(scope) &&
          tabByScope.get(scope)?.availability !== "unavailable-local-directory",
        summary: session.preview,
      });
    }
    return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, workspaceTabs, timeline.items, pinned.items, archived.items, acp.rows, lookup]);
  const refresh = useCallback(async () => {
    acp.refresh();
    await Promise.all([timeline.refresh(), pinned.refresh(), archived.refresh()]);
  }, [timeline.refresh, pinned.refresh, archived.refresh, acp.refresh]);
  const mutate = useCallback(
    async (item: BoardItem, action: BoardAction) => {
      if (!item.online) throw new Error("Workspace unavailable");
      if (
        action !== "pin" &&
        !item.archived &&
        (item.status === "running" || item.status === "waiting")
      )
        throw new Error("Session is active");
      if (item.kind === "native") {
        const mutation: WindowHostControllerMutation =
          action === "pin"
            ? { kind: "pin", pinned: !item.pinned }
            : action === "archive"
              ? { kind: "archive", archived: !item.archived }
              : {
                  kind: "board-completion",
                  completed: item.status !== "completed",
                  expectedUpdatedAt: item.updatedAt,
                };
        if (!services.windowControllerService) throw new Error("Window Controller unavailable");
        await services.windowControllerService.mutateTask({
          address: {
            taskId: item.task.taskId,
            workspacePath: item.workspacePath,
            ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
            ...(item.remoteSessionId ? { remoteSessionId: item.remoteSessionId } : {}),
          },
          mutation,
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
          action:
            action === "pin"
              ? { kind: "pin", pinned: !item.pinned }
              : action === "archive"
                ? { kind: "archive", archived: !item.archived }
                : {
                    kind: "completion",
                    completed: item.status !== "completed",
                    expectedUpdatedAt: item.updatedAt,
                  },
        });
      }
    },
    [services, lookup, refresh],
  );
  return {
    projects,
    canCreateSession: (tab: WorkspaceTabState) =>
      lookup.has(boardWorkspaceKey(tab)) && tab.availability !== "unavailable-local-directory",
    items,
    mutate,
    refresh,
    loading: timeline.loading || pinned.loading || archived.loading || acp.loading,
    error: timeline.error || pinned.error || archived.error || acp.error,
  };
}
