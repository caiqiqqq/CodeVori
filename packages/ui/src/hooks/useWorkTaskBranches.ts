import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitLocalBranchListResult, WorkTaskScope } from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";

export function useWorkTaskBranches(input: WorkTaskScope, enabled = true) {
  const scope = useMemo(
    () => ({
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
      remoteSessionId: input.remoteSessionId,
    }),
    [input.workspacePath, input.workspaceIdentity, input.remoteSessionId],
  );
  const base = useBaseWorkspaceServices();
  const remote = useRemoteWorkspaceSessionStore((state) => state);
  const resolution = useMemo(
    () => resolveWorkspaceServices(scope, base, remote),
    [scope, base, remote],
  );
  const service = resolution?.services.gitService;
  const owner = useMemo(() => ({}), [service, scope, enabled]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const sequence = useRef(0);
  const [read, setRead] = useState<{
    owner: object;
    value: GitLocalBranchListResult | null;
    loading: boolean;
    error: string | null;
  }>({ owner, value: null, loading: enabled, error: null });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const generation = ++sequence.current;
    setRead((previous) => ({
      owner,
      value: previous.owner === owner ? previous.value : null,
      loading: true,
      error: null,
    }));
    try {
      if (!service || !resolution) throw new Error("work-task.disconnected");
      const value = await service.getLocalBranches({ workspacePath: scope.workspacePath });
      // 分支目录是只读投影；切项目/Host 后旧结果不能覆盖新分支草稿。
      if (currentOwner.current === owner && sequence.current === generation)
        setRead({ owner, value, loading: false, error: null });
    } catch (error) {
      if (currentOwner.current === owner && sequence.current === generation)
        setRead({ owner, value: null, loading: false, error: workTaskErrorMessage(error) });
    }
  }, [owner, service, scope, resolution, enabled]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const current = read.owner === owner ? read : { value: null, loading: enabled, error: null };
  return {
    ...current,
    refresh,
    branches: current.value?.branches ?? [],
    currentBranch: current.value?.currentBranchName ?? undefined,
  };
}
