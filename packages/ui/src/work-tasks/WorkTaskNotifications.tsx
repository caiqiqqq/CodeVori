import { useMemo } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useWorkTaskNotifications } from "@/hooks/useWorkTaskNotifications.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { workTaskSidebarScopes } from "@/lib/workTaskSidebarCounts.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

function ProjectNotifications({ scope }: { scope: WorkTaskScope }) {
  const base = useBaseWorkspaceServices();
  const remote = useRemoteWorkspaceSessionStore((state) => state);
  const resolution = resolveWorkspaceServices(scope, base, remote);
  const platform = useOptionalPlatform();
  const { intl } = useZCodeIntl();
  const enabled = useZCodeStoreWithDefault((state) => state.notificationEnabled, true);
  useWorkTaskNotifications({
    scope: { ...scope, remoteSessionId: resolution?.remoteSessionId ?? scope.remoteSessionId },
    service: resolution?.services.workTaskService,
    enabled,
    platform,
    formatMessage: intl.formatMessage,
  });
  return null;
}

/** 窗口级挂载，与当前项目/对话及侧栏是否显示无关；复用项目归属和任务共享读取。 */
export function WorkTaskNotifications({ projects }: { projects: readonly WorkspaceTabState[] }) {
  const tabs = useMemo(
    () => projects.filter((tab) => tab.workspacePurpose !== "conversation"),
    [projects],
  );
  const { resolvedGroups } = useWorktreeProjectGroupsResolution(tabs);
  const scopes = workTaskSidebarScopes(
    resolvedGroups.filter((group) => !group.isLinkedWorktree).map((group) => group.tab),
  );
  return scopes.map(({ key, scope }) => <ProjectNotifications key={key} scope={scope} />);
}
