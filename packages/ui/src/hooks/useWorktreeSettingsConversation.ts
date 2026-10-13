import { ensureTaskNavigationWorkspace } from "@/app-shell/taskNavigationWorkspace.js";
import { useEffect } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import {
  consumeWorktreeSettingsConversation,
  listenWorktreeSettingsConversation,
} from "@/lib/worktreeSettingsNavigation.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { workTaskNavigationStore } from "@/store/workTaskNavigationStore.js";

export function useWorktreeSettingsConversation({
  selectApi,
  selectAcp,
  openWorkTasks,
}: {
  selectApi: (workspacePath: string, id: string, workspaceIdentity?: string) => void;
  selectAcp: (session: AcpSidebarSession) => void;
  openWorkTasks: (scope: WorkTaskScope) => void;
}) {
  const tabs = useTabStoreApi();
  useEffect(
    () =>
      listenWorktreeSettingsConversation((target) => {
        consumeWorktreeSettingsConversation(target);
        if (target.kind === "work-task") {
          // 原因：通知携带远端 scope，path-only addTab 会错误激活本机同路径项目。
          const state = tabs.getState();
          let remoteTabId: string | undefined;
          if (target.scope.workspaceIdentity || target.scope.remoteSessionId) {
            const tab = state.tabs.find(
              (tab) =>
                tab.kind === "workspace" &&
                tab.workspacePath === target.scope.workspacePath &&
                (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
                  (target.scope.workspaceIdentity?.trim() || target.scope.workspacePath) &&
                (!target.scope.remoteSessionId ||
                  tab.remoteSessionId === target.scope.remoteSessionId),
            );
            if (!tab) return;
            remoteTabId = tab.id;
          }
          const navigation = workTaskNavigationStore.getState();
          navigation.selectProject(target.scope);
          navigation.selectTask(target.scope, target.id);
          if (!remoteTabId)
            state.ensureWorkspaceTab(target.scope.workspacePath, { workspacePurpose: "project" });
          // 保持既有顺序：先登记待办视图意图，再激活 tab，避免设置页退出覆盖目标视图。
          openWorkTasks(target.scope);
          if (remoteTabId) state.activateTab(remoteTabId);
          else state.addTab(target.scope.workspacePath);
        } else {
          const workspacePath =
            target.kind === "acp" ? target.session.workspacePath : target.workspacePath;
          const workspaceIdentity =
            target.kind === "acp" ? target.session.workspaceIdentity : target.workspaceIdentity;
          // 修复原因：归档历史来自多工作区，按路径 addTab 会把远端 identity 错建为本地 tab。
          // 复用聊天导航的精确激活边界；缺失远端 attachment 时拒绝导航。
          const result = ensureTaskNavigationWorkspace({
            workspacePath,
            workspaceIdentity,
            activateTabByPath: tabs.getState().activateTabByPath,
            addLocalWorkspaceTab: (path) => {
              tabs.getState().addTab(path);
            },
          });
          if (!result.accepted) return;
          if (target.kind === "acp") selectAcp(target.session);
          else selectApi(workspacePath, target.taskId, workspaceIdentity);
        }
      }),
    [tabs, selectApi, selectAcp, openWorkTasks],
  );
}
