import { useMemo } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useBotTaskNotifier, type BotTaskNotificationSender } from "@/hooks/useBotTaskNotifier.js";
import { useWorkspaceTerminalTaskNotifications } from "@/hooks/useTaskNotifications.js";
import { useAcpTaskNotifications } from "@/hooks/useAcpTaskNotifications.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

type NotificationScope = WorkTaskScope & { remoteTarget?: unknown };

function SessionObserver({
  scope,
  botNotifier,
  workTaskScope,
}: {
  scope: WorkTaskScope;
  botNotifier: BotTaskNotificationSender;
  workTaskScope: WorkTaskScope;
}) {
  const { intl } = useZCodeIntl();
  useWorkspaceTerminalTaskNotifications({
    ...scope,
    endpointKey: scope.remoteSessionId,
    enabled: false,
    rpcReady: true,
    platform: null,
    botNotifier,
    workTaskScope,
    formatMessage: intl.formatMessage,
  });
  useAcpTaskNotifications({
    ...scope,
    enabled: false,
    rpcReady: true,
    platform: null,
    botNotifier,
    workTaskScope,
    formatMessage: intl.formatMessage,
  });
  return null;
}

function WorkspaceObserver({
  scope,
  workTaskScope,
}: {
  scope: NotificationScope;
  workTaskScope: WorkTaskScope;
}) {
  const base = useBaseWorkspaceServices();
  const remote = useRemoteWorkspaceSessionStore((state) => state);
  const resolution = resolveWorkspaceServices(scope, base, remote);
  const resolvedScope = {
    ...scope,
    remoteSessionId: resolution?.remoteSessionId ?? scope.remoteSessionId,
  };
  const botNotifier = useBotTaskNotifier(resolvedScope);
  // 远端断连只撤销观察，不允许按同路径回落到本机或建立新的 attachment。
  if (!resolution || !botNotifier) return null;
  return (
    <ServiceProvider services={resolution.services}>
      <SessionObserver
        scope={resolvedScope}
        workTaskScope={{
          ...workTaskScope,
          remoteSessionId: resolution.remoteSessionId ?? workTaskScope.remoteSessionId,
        }}
        botNotifier={botNotifier}
      />
    </ServiceProvider>
  );
}

/** 与选中项目无关；会话观察复用已有 registry，机器人投递统一交给基础 Host。 */
export function BotWorkspaceNotifications({
  projects,
}: {
  projects: readonly WorkspaceTabState[];
}) {
  const { resolvedGroups } = useWorktreeProjectGroupsResolution(projects);
  const scopes = useMemo(() => {
    const unique = new Map<string, { scope: NotificationScope; workTaskScope: WorkTaskScope }>();
    for (const group of resolvedGroups) {
      for (const project of group.workspaceTabs) {
        const { workspacePath } = project;
        if (!workspacePath) continue;
        const workspaceIdentity = project.workspaceIdentity?.trim() || undefined;
        const remoteSessionId = project.remoteSessionId?.trim() || undefined;
        unique.set(
          JSON.stringify([
            Boolean(project.remoteTarget),
            workspaceIdentity || workspacePath,
            workspacePath,
            remoteSessionId || "",
          ]),
          {
            scope: {
              workspacePath,
              workspaceIdentity,
              remoteSessionId,
              remoteTarget: project.remoteTarget,
            },
            // 修复依据：独立工作树的待办绑定持久化在主项目，不能用执行目录查空表后重复通知。
            workTaskScope: {
              workspacePath: group.tab.workspacePath,
              workspaceIdentity: group.tab.workspaceIdentity?.trim() || undefined,
              remoteSessionId: group.tab.remoteSessionId?.trim() || undefined,
            },
          },
        );
      }
    }
    return [...unique.entries()];
  }, [resolvedGroups]);
  return scopes.map(([key, { scope, workTaskScope }]) => (
    <WorkspaceObserver key={key} scope={scope} workTaskScope={workTaskScope} />
  ));
}
