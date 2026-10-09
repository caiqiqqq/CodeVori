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
  selectApi: (workspacePath: string, id: string) => void;
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
        } else if (target.kind === "acp") {
          tabs.getState().addTab(target.session.workspacePath);
          selectAcp(target.session);
        } else {
          tabs.getState().addTab(target.workspacePath);
          selectApi(target.workspacePath, target.taskId);
        }
      }),
    [tabs, selectApi, selectAcp, openWorkTasks],
  );
}
