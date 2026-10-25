import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUuid, type ComposerPreference, type ComposerPreferenceTarget } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { logger } from "@/logger.js";

export function useComposerPreference(workspacePath: string, workspaceIdentity?: string) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    workspacePath,
    undefined,
    workspaceIdentity,
  );
  const service = rpcReady ? services.composerPreferenceService : undefined;
  const key = workspaceIdentity?.trim() || workspacePath;
  const [state, setState] = useState<{
    service: typeof service;
    key: string;
    snapshot: ComposerPreference | null;
    ready: boolean;
    error: "read" | "write" | null;
  }>({ service, key, snapshot: null, ready: rpcReady && !service, error: null });
  const binding = useMemo(() => ({ service, key }), [service, key]);
  const owner = useRef(binding);
  owner.current = binding;
  const writeVersion = useRef(0);
  const matches = state.service === service && state.key === key;

  useEffect(() => {
    let disposed = false;
    const commit = (snapshot: ComposerPreference) => {
      if (disposed || owner.current !== binding) return;
      setState((current) => {
        if (
          current.service === service &&
          current.key === key &&
          current.snapshot &&
          current.snapshot.revision > snapshot.revision
        )
          return current;
        return { service, key, snapshot, ready: true, error: null };
      });
    };
    if (!service) {
      setState({ service, key, snapshot: null, ready: rpcReady, error: null });
      return;
    }
    const scope = { workspacePath, ...(workspaceIdentity ? { workspaceIdentity } : {}) };
    // 修复原因：手机会错过离线期间的广播；先订阅再读权威快照，并拒绝迟到的旧版本。
    const subscription = service.onDynamicChanged(scope)(commit);
    void service
      .get(scope)
      .then(commit)
      .catch((cause: unknown) => {
        if (disposed) return;
        logger.warn("[composer-preference] 读取模型偏好失败", { cause });
        setState((current) =>
          current.service === service && current.key === key && current.snapshot
            ? current
            : { service, key, snapshot: null, ready: true, error: "read" },
        );
      });
    return () => {
      disposed = true;
      subscription.dispose();
    };
  }, [service, key, workspacePath, workspaceIdentity, binding, rpcReady]);

  const select = useCallback(
    (target: ComposerPreferenceTarget) => {
      if (!service) return;
      const version = ++writeVersion.current;
      const input = { workspacePath, workspaceIdentity, commandId: createUuid(), target };
      void service
        .update(input)
        .then((snapshot) => {
          if (owner.current !== binding) return;
          setState((current) =>
            current.service === service &&
            current.key === key &&
            current.snapshot &&
            current.snapshot.revision > snapshot.revision
              ? current
              : { service, key, snapshot, ready: true, error: null },
          );
        })
        .catch((cause: unknown) => {
          if (owner.current !== binding || version !== writeVersion.current) return;
          logger.warn("[composer-preference] 保存模型偏好失败", { cause });
          setState((current) => ({ ...current, service, key, ready: true, error: "write" }));
        });
    },
    [service, key, workspacePath, workspaceIdentity, binding],
  );
  return {
    snapshot: matches ? state.snapshot : null,
    ready: rpcReady && (!service || (matches && state.ready)),
    error: matches ? state.error : null,
    select,
  };
}

export type ComposerPreferenceRead = ReturnType<typeof useComposerPreference>;
