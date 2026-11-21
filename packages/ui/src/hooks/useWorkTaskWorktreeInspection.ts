import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkTask, WorkTaskWorktreeInspection } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";

export function useWorkTaskWorktreeInspection(task: WorkTask | null) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    task?.workspacePath ?? "",
    task?.remoteSessionId,
    task?.workspaceIdentity,
  );
  const service = services.workTaskService;
  const key = `${task?.workspaceIdentity ?? task?.workspacePath}:${task?.id}:${task?.worktree?.acceptedBranchName ?? ""}`;
  const generation = useRef(0);
  const [state, setState] = useState<{
    key: string;
    inspection: WorkTaskWorktreeInspection | null;
    error: string | null;
  } | null>(null);
  const refresh = useCallback(async () => {
    if (!task?.worktree || !service || !rpcReady) return;
    const current = ++generation.current;
    try {
      const next = await service.inspectWorktree({
        workspacePath: task.workspacePath,
        workspaceIdentity: task.workspaceIdentity,
        remoteSessionId: task.remoteSessionId,
        id: task.id,
      });
      if (current === generation.current) setState({ key, inspection: next, error: null });
    } catch (cause) {
      if (current === generation.current)
        setState({
          key,
          inspection: null,
          error: cause instanceof Error ? cause.message : String(cause),
        });
    }
  }, [
    key,
    rpcReady,
    service,
    task?.id,
    task?.workspacePath,
    task?.workspaceIdentity,
    task?.remoteSessionId,
    task?.worktree,
  ]);
  useEffect(() => {
    void refresh();
    if (!task?.worktree) return;
    // Git can change outside the Host. Refresh while the task view is open and on focus.
    const timer = setInterval(() => void refresh(), 3000);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, task?.worktree]);
  return {
    inspection: state?.key === key ? state.inspection : null,
    error: state?.key === key ? state.error : null,
    refresh,
  };
}
