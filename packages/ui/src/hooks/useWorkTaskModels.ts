import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ZCODE_AGENT_PROVIDER,
  type AcpAgentConfigSnapshot,
  type WorkTaskScope,
} from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { useModelSelectionServiceView } from "./useModelSelectionView.js";
import { useAvailableAcpAgents } from "@/v4/composer/useAvailableAcpAgents.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { logger } from "@/logger.js";

export function useWorkTaskModels(scope: WorkTaskScope) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.remoteSessionId,
    scope.workspaceIdentity,
  );
  const modelRead = useModelSelectionServiceView(services.modelSelectionService, rpcReady);
  const agents = useAvailableAcpAgents(rpcReady ? services.acpService : null, rpcReady);
  const owner = useMemo(
    () => ({}),
    [
      services.acpService,
      scope.workspacePath,
      scope.workspaceIdentity,
      scope.remoteSessionId,
      rpcReady,
    ],
  );
  const [catalog, setCatalog] = useState<{
    owner: object;
    configs: AcpAgentConfigSnapshot[];
    status: "loading" | "ready" | "error";
    available: boolean;
    error: string | null;
  }>({
    owner,
    configs: [],
    status: "loading",
    available: false,
    error: null,
  });
  const sequence = useRef(0);
  const refreshConfigs = useCallback(async () => {
    if (!rpcReady) return;
    const request = ++sequence.current;
    setCatalog((previous) => ({
      owner,
      configs: previous.owner === owner ? previous.configs : [],
      available: previous.owner === owner && previous.available,
      status: "loading",
      error: null,
    }));
    try {
      const configs = await services.acpService.listAgentConfigs({
        workspacePath: scope.workspacePath,
        workspaceIdentity: scope.workspaceIdentity,
        remoteSessionId: scope.remoteSessionId,
      });
      // 修复原因：快速切项目或重读目录时，旧 Host/旧请求不能覆盖新投影和草稿。
      if (sequence.current === request)
        setCatalog({ owner, configs, status: "ready", available: true, error: null });
    } catch (error) {
      if (sequence.current !== request) return;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("[work-tasks] ACP configuration catalog read failed", { error: message });
      setCatalog((previous) => ({
        owner,
        configs: previous.owner === owner ? previous.configs : [],
        available: previous.owner === owner && previous.available,
        status: "error",
        error: message,
      }));
    }
  }, [
    rpcReady,
    owner,
    services.acpService,
    scope.workspacePath,
    scope.workspaceIdentity,
    scope.remoteSessionId,
  ]);
  useEffect(() => {
    if (!rpcReady) return;
    void refreshConfigs();
    return () => {
      sequence.current++;
    };
  }, [rpcReady, refreshConfigs]);
  const catalogAvailable = catalog.owner === owner && catalog.available;
  useEffect(() => {
    // 修复原因：旧 Host 没有新增事件；先由成功查询确认接口，再订阅并补读，
    // 避免未知事件影响已有 API，也不丢失初次查询与订阅之间的配置变更。
    if (!rpcReady || !catalogAvailable) return;
    const subscription = services.acpService.onDynamicAgentConfigsChanged()(() => {
      void refreshConfigs();
    });
    void refreshConfigs();
    return () => subscription.dispose();
  }, [services.acpService, rpcReady, refreshConfigs, catalogAvailable]);
  const view = modelRead.state.status === "ready" ? modelRead.state.view : null;
  const apiGroups = useMemo(
    () => (view ? buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view) : []),
    [view],
  );
  return {
    view,
    apiGroups,
    agents: agents.agents,
    refreshAgents: agents.refresh,
    configs: catalog.owner === owner ? catalog.configs : [],
    configStatus: catalog.owner === owner ? catalog.status : "loading",
    configError: catalog.owner === owner ? catalog.error : null,
    refreshConfigs,
  };
}
