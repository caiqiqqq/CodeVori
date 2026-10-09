import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskCreate, WorkTaskScope, WorkTaskUpdate } from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";
import { getWorkTaskReadModel } from "./workTaskReadModel.js";

const subscribeToNothing = () => () => {};
const unavailableSnapshot = { data: null, error: null, loading: false };
const getUnavailableSnapshot = () => unavailableSnapshot;

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
  const resource = useMemo(
    () => (service && rpcReady ? getWorkTaskReadModel(service, scope, includeArchived) : null),
    [service, rpcReady, scope, includeArchived],
  );
  const read = useSyncExternalStore(
    resource?.subscribe ?? subscribeToNothing,
    resource?.getSnapshot ?? getUnavailableSnapshot,
    resource?.getSnapshot ?? getUnavailableSnapshot,
  );
  const owner = useMemo(() => ({}), [resource, scope]);
  const [mutation, setMutation] = useState<{
    owner: typeof owner;
    error: string | null;
    busy: boolean;
  }>({
    owner,
    error: null,
    busy: false,
  });
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const refresh = useCallback(async () => {
    await resource?.refresh(true);
  }, [resource]);
  const run = useCallback(
    async (action: (target: IWorkTaskService) => Promise<unknown>): Promise<boolean> => {
      if (!service || !resource || !rpcReady) return false;
      const version = resource.getEventVersion();
      setMutation({ owner, error: null, busy: true });
      try {
        await action(service);
        resource.refreshAfterMutation(version);
        if (ownerRef.current === owner) setMutation({ owner, error: null, busy: false });
        return ownerRef.current === owner;
      } catch (error) {
        // update 成功而 start 失败仍投影已保存内容；列表失败不能覆盖命令错误。
        resource.refreshAfterMutation(version);
        if (ownerRef.current === owner)
          setMutation({ owner, error: workTaskErrorMessage(error), busy: false });
        return false;
      }
    },
    [owner, service, resource, rpcReady],
  );
  const current = resource
    ? { board: read.data, loading: read.loading, error: read.error }
    : {
        board: null,
        loading: false,
        error: !rpcReady ? "work-task.disconnected" : "work-task.unsupported-host",
      };
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
    archiveAndRemoveWorktree: (id: string) =>
      run((target) => target.archive({ ...scope, id, archived: true, removeWorktree: true })),
    setConcurrency: (concurrency: number) =>
      run((target) => target.setConcurrency({ ...scope, concurrency })),
  };
}
