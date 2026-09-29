import { useEffect, useMemo, useRef, useState } from "react";
import type { AcpPlugin } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

const EMPTY = { plugins: [] as AcpPlugin[], loading: false, error: null as string | null };

/** ACP Host owns the live menu catalog; late results cannot cross workspace/attachment boundaries. */
export function useAcpPlugins(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
  enabled: boolean,
) {
  const resolution = useWorkspaceServicesResolution(workspacePath, undefined, workspaceIdentity);
  const [state, setState] = useState<{ scope: object; value: typeof EMPTY } | null>(null);
  const sequence = useRef(0);
  const scope = useMemo(
    () => ({}),
    [
      enabled,
      workspacePath,
      workspaceIdentity,
      sessionId,
      resolution.remoteSessionId,
      resolution.services,
      resolution.rpcReady,
    ],
  );
  useEffect(() => {
    if (!enabled || !workspacePath || !resolution.rpcReady) return;
    const current = ++sequence.current;
    let active = true;
    setState({ scope, value: { ...EMPTY, loading: true } });
    resolution.services.acpService
      .listPlugins({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(resolution.remoteSessionId ? { remoteSessionId: resolution.remoteSessionId } : {}),
        ...(sessionId ? { id: sessionId } : {}),
      })
      .then((plugins) => {
        if (active && current === sequence.current)
          setState({ scope, value: { plugins, loading: false, error: null } });
      })
      .catch((cause: unknown) => {
        if (!active || current !== sequence.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.warn("[useAcpPlugins] 获取目标 Host 插件目录失败", { error: message });
        setState({ scope, value: { ...EMPTY, error: message } });
      });
    return () => {
      active = false;
    };
  }, [
    enabled,
    resolution.remoteSessionId,
    resolution.rpcReady,
    resolution.services,
    scope,
    sessionId,
    workspaceIdentity,
    workspacePath,
  ]);
  return enabled && state?.scope === scope ? state.value : EMPTY;
}
