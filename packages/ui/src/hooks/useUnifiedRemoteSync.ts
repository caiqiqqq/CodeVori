import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "./useWorkspaceServices.js";
import {
  useRemoteSyncDialogIntent,
  shouldShowRemoteSyncActions,
} from "@/settings/RemoteSyncActions.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export function useUnifiedRemoteSync(target: WorkspaceTabState | undefined, isDesktop: boolean) {
  const local = useBaseWorkspaceServices();
  const resolved = useWorkspaceServicesResolution(
    target?.workspacePath,
    target?.remoteSessionId,
    target?.workspaceIdentity,
    target?.remoteTarget,
    true,
  );
  const key = target
    ? `${target.workspaceIdentity?.trim() || target.workspacePath}\0${resolved.remoteSessionId ?? ""}`
    : "";
  const skills = useRemoteSyncDialogIntent({ rpcReady: resolved.rpcReady, targetKey: key });
  const mcp = useRemoteSyncDialogIntent({ rpcReady: resolved.rpcReady, targetKey: key });
  const plugins = useRemoteSyncDialogIntent({ rpcReady: resolved.rpcReady, targetKey: key });
  const available =
    isDesktop &&
    resolved.rpcReady &&
    shouldShowRemoteSyncActions({
      remoteSessionId: resolved.remoteSessionId,
      remoteTarget: target?.remoteTarget,
      clientMode: isDesktop ? "desktop-continuous" : "web-remote-replayable",
    });
  return {
    available,
    skills,
    mcp,
    plugins,
    dialogs: {
      localSkillSyncService: local.skillSyncService,
      remoteSkillSyncService: resolved.services.skillSyncService,
      localMcpSyncService: local.mcpSyncService,
      remoteMcpSyncService: resolved.services.mcpSyncService,
      localPluginSyncService: local.pluginSyncService,
      remotePluginSyncService: resolved.services.pluginSyncService,
      localZCodeAgentService: local.zcodeAgentService,
      remoteZCodeAgentService: resolved.services.zcodeAgentService,
    },
  };
}
