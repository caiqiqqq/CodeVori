import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acpAgentConfigCatalogSchema, type AcpAgentConfigSnapshot } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";

/** 只读取目标 Host 已知的 ACP 选项；不创建会话，也不把目录当前值写进智能体草稿。 */
export function useAgentProfileConfigs(workspacePath: string | null) {
  const resolution = useWorkspaceServicesResolution(workspacePath);
  const service =
    workspacePath && resolution.rpcReady && !resolution.isRemoteTarget
      ? resolution.services.acpService
      : null;
  const owner = useMemo(() => ({}), [service, workspacePath]);
  const current = useRef(owner);
  current.current = owner;
  const sequence = useRef(0);
  const [state, setState] = useState<{
    owner: object;
    configs: AcpAgentConfigSnapshot[];
    loading: boolean;
    error: boolean;
  }>({ owner, configs: [], loading: Boolean(service), error: false });
  const refresh = useCallback(async () => {
    if (!service || !workspacePath) return;
    const request = ++sequence.current;
    setState((previous) => ({
      owner,
      configs: previous.owner === owner ? previous.configs : [],
      loading: true,
      error: false,
    }));
    try {
      const configs = acpAgentConfigCatalogSchema.parse(
        await service.listAgentConfigs({ workspacePath }),
      );
      if (current.current === owner && sequence.current === request)
        setState({ owner, configs, loading: false, error: false });
    } catch {
      if (current.current === owner && sequence.current === request)
        setState((previous) => ({ ...previous, owner, loading: false, error: true }));
    }
  }, [service, workspacePath, owner]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  return {
    configs: state.owner === owner && service ? state.configs : [],
    loading: Boolean(service) && (state.owner !== owner || state.loading),
    error: state.owner === owner && state.error,
    refresh,
  };
}
