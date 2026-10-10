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
          const navigation = workTaskNavigationStore.getState();
          navigation.selectProject(target.scope);
          navigation.selectTask(target.scope, target.id);
          // 只打开本地主项目，避免把待办执行工作树新增为项目对话入口。
          tabs
            .getState()
            .ensureWorkspaceTab(target.scope.workspacePath, { workspacePurpose: "project" });
          openWorkTasks(target.scope);
          tabs.getState().addTab(target.scope.workspacePath);
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
