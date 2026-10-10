import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { IWorkTaskService } from "@zcode/services";
import type {
  WorkTaskCreate,
  WorkTaskScope,
  WorkTaskUpdate,
  WorkTaskForgeOptions,
} from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { workTaskNavigationKey } from "@/store/workTaskNavigationStore.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";
import { getWorkTaskReadModel } from "./workTaskReadModel.js";
import { combineWorkTaskReads } from "./workTaskCombinedRead.js";

type Run = (
  scope: WorkTaskScope,
  action: (target: IWorkTaskService) => Promise<unknown>,
  onError?: (error: string) => void,
) => Promise<boolean>;
function scopeOnly(input: WorkTaskScope): WorkTaskScope {
  // 项目 tab 和任务记录都包含额外字段；严格协议只接受三项 scope，不能直接展开整条记录。
  return {
    workspacePath: input.workspacePath,
    ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
    ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
  };
}
function commands(scope: WorkTaskScope, run: Run) {
  return {
    scope,
    create: (draft: Omit<WorkTaskCreate, keyof WorkTaskScope>) =>
      run(scope, (target) => target.create({ ...scope, ...draft })),
    update: (draft: Omit<WorkTaskUpdate, keyof WorkTaskScope>, startAfterSave = false) =>
      run(scope, async (target) => {
        // 保存与入队共用一次忙碌操作，避免两次请求之间恢复按钮或使用尚未保存的描述。
        await target.update({ ...scope, ...draft });
        if (startAfterSave) await target.start({ ...scope, id: draft.id });
      }),
    start: (id: string, feedback?: string) =>
      run(scope, (target) => target.start({ ...scope, id, ...(feedback ? { feedback } : {}) })),
    startAll: () => run(scope, (target) => target.startAll(scope)),
    cancel: (id: string) => run(scope, (target) => target.cancel({ ...scope, id })),
    complete: (id: string, forge?: WorkTaskForgeOptions, resendComment?: boolean) =>
      run(scope, (target) =>
        target.complete({
          ...scope,
          id,
          ...(forge ? { forge } : {}),
          ...(resendComment ? { resendComment } : {}),
        }),
      ),
    merge: (id: string, targetBranch: string, forge?: WorkTaskForgeOptions) =>
      run(scope, (target) =>
        target.merge({ ...scope, id, targetBranch, ...(forge ? { forge } : {}) }),
      ),
    archive: (id: string, archived: boolean) =>
      run(scope, (target) => target.archive({ ...scope, id, archived })),
    archiveAndRemoveWorktree: (id: string, onError: (error: string) => void) =>
      run(
        scope,
        (target) => target.archive({ ...scope, id, archived: true, removeWorktree: true }),
        onError,
      ),
    setConcurrency: (concurrency: number) =>
      run(scope, (target) => target.setConcurrency({ ...scope, concurrency })),
  };
}

export type WorkTaskPanel = ReturnType<typeof commands> & {
  board: import("@zcode/shared").WorkTaskBoard | null;
  loading: boolean;
  settled: boolean;
  error: string | null;
  busy: boolean;
  executable: boolean;
  refresh(): Promise<void>;
};

export function useWorkTasks(
  input: WorkTaskScope,
  includeArchived: boolean,
  projectSelected = true,
  projectScopes?: readonly WorkTaskScope[],
): WorkTaskPanel & { forScope(scope: WorkTaskScope): WorkTaskPanel } {
  const scope = useMemo(
    () => scopeOnly(input),
    [input.workspacePath, input.workspaceIdentity, input.remoteSessionId],
  );
  const baseServices = useBaseWorkspaceServices();
  const remoteState = useRemoteWorkspaceSessionStore((state) => state);
  const sources = useMemo(() => {
    const unique = new Map(
      (projectScopes ?? [scope]).map((item) => [workTaskNavigationKey(item), item]),
    );
    return [...unique.values()].map((input) => {
      const item = scopeOnly(input);
      // 显式 scope 避免同路径本地查询误发远端；断连绝不回落本机。
      const resolution = resolveWorkspaceServices(item, baseServices, remoteState);
      const service = resolution?.services.workTaskService;
      return {
        scope: item,
        service,
        resource: service ? getWorkTaskReadModel(service, item, includeArchived) : null,
        error: !resolution
          ? "work-task.disconnected"
          : !service
            ? "work-task.unsupported-host"
            : null,
        executable: projectSelected && !!service && !resolution?.isRemoteWorkspace,
      };
    });
  }, [scope, projectScopes, baseServices, remoteState, includeArchived, projectSelected]);
  const resource = useMemo(() => combineWorkTaskReads(sources), [sources]);
  const read = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const owner = useMemo(() => ({}), [resource]);
  const [mutation, setMutation] = useState<{
    owner: typeof owner;
    error: string | null;
    busy: boolean;
  }>({ owner, error: null, busy: false });
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const run = useCallback<Run>(
    async (targetScope, action, onError) => {
      const source = sources.find(
        (item) => workTaskNavigationKey(item.scope) === workTaskNavigationKey(targetScope),
      );
      if (!source?.service || !source.resource) return false;
      const version = source.resource.getEventVersion();
      setMutation({ owner, error: null, busy: true });
      try {
        await action(source.service);
        source.resource.refreshAfterMutation(version);
        if (ownerRef.current === owner) setMutation({ owner, error: null, busy: false });
        return ownerRef.current === owner;
      } catch (error) {
        // update 成功而 start 失败仍投影已保存内容；列表失败不能覆盖命令错误。
        source.resource.refreshAfterMutation(version);
        if (ownerRef.current === owner) {
          const message = workTaskErrorMessage(error);
          // 删除失败属于当前确认弹窗；共享错误会在列表重复显示并在关窗后残留。
          setMutation({ owner, error: onError ? null : message, busy: false });
          onError?.(message);
        }
        return false;
      }
    },
    [owner, sources],
  );
  const forScope = (target: WorkTaskScope): WorkTaskPanel => ({
    ...commands(scopeOnly(target), run),
    board: read.data,
    loading: read.loading,
    settled: read.settled,
    error: mutation.owner === owner && mutation.error ? mutation.error : read.error,
    busy: mutation.owner === owner && mutation.busy,
    executable: sources.some(
      (item) =>
        workTaskNavigationKey(item.scope) === workTaskNavigationKey(target) && item.executable,
    ),
    refresh: resource.refresh,
  });
  const panel = forScope(scope);
  return {
    ...panel,
    forScope,
    executable: sources.some((source) => source.executable),
    startAll: async () => {
      // 全部开始沿用各项目 admission；只提交可执行项目，不把全部伪装成 scope。
      let success = true;
      for (const source of sources) {
        if (
          !source.executable ||
          !source.resource
            ?.getSnapshot()
            .data?.tasks.some((task) => !task.archived && task.status === "todo")
        )
          continue;
        if (!(await run(source.scope, (target) => target.startAll(source.scope)))) {
          success = false;
          break;
        }
      }
      return success;
    },
  };
}
