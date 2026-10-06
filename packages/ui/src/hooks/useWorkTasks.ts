import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskBoard, WorkTaskCreate, WorkTaskScope, WorkTaskUpdate } from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";

export function useWorkTasks(
  input: WorkTaskScope,
  includeArchived: boolean,
  projectSelected = true,
) {
  const scope = useMemo(
    () => ({
      workspacePath: input.workspacePath,
      ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
    }),
    [input.workspacePath, input.workspaceIdentity, input.remoteSessionId],
  );
  const baseServices = useBaseWorkspaceServices();
  const remoteState = useRemoteWorkspaceSessionStore((state) => state);
  // 待办已有显式项目作用域；按活动 tab 推断会把同路径的本地查询误发到远端 Host。
  const resolution = useMemo(
    () => resolveWorkspaceServices(scope, baseServices, remoteState),
    [scope, baseServices, remoteState],
  );
  const service = resolution?.services.workTaskService;
  const rpcReady = !!resolution;
  const owner = useMemo(() => ({}), [service, scope, includeArchived, rpcReady]);
  const generation = useRef(0);
  const [read, setRead] = useState<{
    owner: object;
    board: WorkTaskBoard | null;
    error: string | null;
    loading: boolean;
  }>({ owner, board: null, error: null, loading: true });
  const [mutation, setMutation] = useState<{ owner: object; error: string | null; busy: boolean }>({
    owner,
    error: null,
    busy: false,
  });
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    if (!service || !rpcReady) {
      setRead({
        owner,
        board: null,
        loading: false,
        error: !rpcReady ? "work-task.disconnected" : "work-task.unsupported-host",
      });
      return;
    }
    try {
      const board = await service.list({ ...scope, includeArchived });
      if (ownerRef.current === owner && generation.current === seq)
        setRead({ owner, board, loading: false, error: null });
    } catch (error) {
      if (ownerRef.current === owner && generation.current === seq)
        setRead((previous) => ({
          owner,
          board: previous.owner === owner ? previous.board : null,
          loading: false,
          error: workTaskErrorMessage(error),
        }));
    }
  }, [owner, service, rpcReady, scope, includeArchived]);
  useEffect(() => {
    setRead({ owner, board: null, loading: true, error: null });
    void refresh();
    if (!service || !rpcReady) return;
    const listener = service.onDynamicChanged(scope)(() => {
      void refresh();
    });
    return () => {
      generation.current++;
      listener.dispose();
    };
  }, [owner, refresh, service, scope, rpcReady]);
  const run = useCallback(
    async (action: (target: IWorkTaskService) => Promise<unknown>): Promise<boolean> => {
      if (!service || !rpcReady) return false;
      setMutation({ owner, error: null, busy: true });
      try {
        await action(service);
        await refresh();
        if (ownerRef.current === owner) setMutation({ owner, error: null, busy: false });
        return true;
      } catch (error) {
        if (ownerRef.current === owner)
          setMutation({ owner, error: workTaskErrorMessage(error), busy: false });
        return false;
      }
    },
    [owner, service, rpcReady, refresh],
  );
  const current = read.owner === owner ? read : { board: null, loading: true, error: null };
  return {
    ...current,
    scope,
    error: mutation.owner === owner && mutation.error ? mutation.error : current.error,
    busy: mutation.owner === owner && mutation.busy,
    executable: projectSelected && rpcReady && !resolution.isRemoteWorkspace && !!service,
    refresh,
    create: (draft: Omit<WorkTaskCreate, keyof WorkTaskScope>) =>
      run((target) => target.create({ ...scope, ...draft })),
    update: (draft: Omit<WorkTaskUpdate, keyof WorkTaskScope>, startAfterSave = false) =>
      run(async (target) => {
        // 保存与入队共用一次忙碌操作，避免两次请求之间恢复按钮或使用尚未保存的描述。
        await target.update({ ...scope, ...draft });
        if (startAfterSave) await target.start({ ...scope, id: draft.id });
      }),
    start: (id: string, feedback?: string) =>
      run((target) => target.start({ ...scope, id, ...(feedback ? { feedback } : {}) })),
    startAll: () => run((target) => target.startAll(scope)),
    cancel: (id: string) => run((target) => target.cancel({ ...scope, id })),
    complete: (id: string) => run((target) => target.complete({ ...scope, id })),
    merge: (id: string, targetBranch: string) =>
      run((target) => target.merge({ ...scope, id, targetBranch })),
    archive: (id: string, archived: boolean) =>
      run((target) => target.archive({ ...scope, id, archived })),
    setConcurrency: (concurrency: number) =>
      run((target) => target.setConcurrency({ ...scope, concurrency })),
  };
}
