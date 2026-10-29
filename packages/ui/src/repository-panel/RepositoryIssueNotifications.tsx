import { useMemo } from "react";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useRepositoryIssueSources } from "@/hooks/useRepositoryIssueCounts.js";
import { useRepositoryIssueNotifications } from "@/hooks/useRepositoryIssueNotifications.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

/** 与侧栏共享项目归属和查询；窗口观察不依赖当前面板是否挂载。 */
export function RepositoryIssueNotifications({
  projects,
}: {
  projects: readonly WorkspaceTabState[];
}) {
  const tabs = useMemo(
    () => projects.filter((tab) => tab.workspacePurpose !== "conversation"),
    [projects],
  );
  const { resolvedGroups } = useWorktreeProjectGroupsResolution(tabs);
  const eligible = useMemo(
    () => resolvedGroups.filter((group) => !group.isLinkedWorktree).map((group) => group.tab),
    [resolvedGroups],
  );
  const sources = useRepositoryIssueSources(eligible);
  const platform = useOptionalPlatform();
  const enabled = useZCodeStoreWithDefault((state) => state.notificationEnabled, true);
  const { intl } = useZCodeIntl();
  useRepositoryIssueNotifications({
    sources,
    enabled,
    platform,
    formatMessage: intl.formatMessage,
  });
  return null;
}
