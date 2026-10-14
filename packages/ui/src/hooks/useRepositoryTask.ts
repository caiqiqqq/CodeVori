import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  workTaskSourceKey,
  type WorkTask,
  type WorkTaskSource,
  type ForgeItem,
  type ForgeRepository,
  type ForgeTargetRequest,
  type WorkTaskCreate,
  type WorkTaskScope,
} from "@zcode/shared";
import { buildForgeAgentPrompt } from "@/lib/forgePanel.js";
import { prepareForgeTaskImages } from "@/lib/forgeTaskImages.js";
import { isWorkTaskExecutionAvailable } from "@/store/workTaskExecutionPreferenceStore.js";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { useWorkTasks } from "./useWorkTasks.js";
import { useForgeMutation } from "./useForgeMutation.js";

/** Draft preparation only; accepted tasks remain owned by the repository's Host. */
export function useRepositoryTask(scope: WorkTaskScope, target: ForgeTargetRequest | null) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.remoteSessionId,
    scope.workspaceIdentity,
  );
  const { gitService, workTaskService, modelSelectionService, acpService } = services;
  const owner = useMemo(
    () => ({}),
    [
      target,
      scope.workspacePath,
      scope.workspaceIdentity,
      scope.remoteSessionId,
      gitService,
      workTaskService,
      modelSelectionService,
      acpService,
      rpcReady,
    ],
  );
  const ownerRef = useRef<object | null>(owner);
  ownerRef.current = owner;
  useLayoutEffect(() => {
    ownerRef.current = owner;
    return () => {
      ownerRef.current = null;
    };
  }, [owner]);
  const mutation = useForgeMutation(target && rpcReady ? owner : null);
  const tasks = useWorkTasks(scope, true, !!target && rpcReady);
  const links = useMemo(() => {
    const result = new Map<string, WorkTask>();
    for (const task of tasks.board?.tasks ?? []) {
      if (!task.source) continue;
      const key = workTaskSourceKey(task.source);
      const previous = result.get(key);
      if (
        !previous ||
        task.createdAt > previous.createdAt ||
        (task.createdAt === previous.createdAt && task.id > previous.id)
      )
        result.set(key, task);
    }
    return result;
  }, [tasks.board]);
  const linkedTask = (item: ForgeItem): WorkTask | undefined =>
    target
      ? links.get(workTaskSourceKey({ ...target, kind: item.kind, number: item.number }))
      : undefined;
  const isCreated = (item: ForgeItem) => {
    const task = linkedTask(item);
    return !!task && !["failed", "canceled"].includes(task.status);
  };
  const [prepared, setPrepared] = useState<{
    owner: object;
    key: string;
    initialDraft: Pick<WorkTaskCreate, "title" | "prompt"> & { attachmentFiles: File[] };
    source: WorkTaskSource;
  } | null>(null);
  useLayoutEffect(() => {
    // 截图 File 只属于原目标；切换 Host/项目时释放旧草稿，不能仅隐藏后长期保留。
    setPrepared((previous) => (previous?.owner === owner ? previous : null));
  }, [owner]);
  const draft = prepared?.owner === owner ? prepared : null;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const preparingRef = useRef<object | null>(null);
  const [preparation, setPreparation] = useState<{
    owner: object;
    token: object;
    phase: "detail" | "images";
    completed: number;
    total: number;
  } | null>(null);
  const itemKey = (item: ForgeItem) => `${item.kind}:${item.number}`;
  const prepare = async (repository: ForgeRepository, item: ForgeItem, again = false) => {
    if (!target || !rpcReady || draft || (isCreated(item) && !again)) return;
    const result = await mutation.run(async () => {
      const token = {};
      preparingRef.current = token;
      const isCurrent = () => ownerRef.current === owner && preparingRef.current === token;
      setPreparation({ owner, token, phase: "detail", completed: 0, total: 0 });
      try {
        if (!workTaskService) throw new Error("FORGE_TASK_UNSUPPORTED");
        const detail = await gitService.getForgeItem({
          ...target,
          kind: item.kind,
          number: item.number,
        });
        if (!isCurrent()) return null;
        if (!detail.url) throw new Error("FORGE_INVALID_ITEM");
        const attachmentFiles = await prepareForgeTaskImages(
          repository,
          detail,
          target,
          gitService,
          isCurrent,
          (completed, total) => setPreparation({ owner, token, phase: "images", completed, total }),
        );
        if (!isCurrent()) return null;
        return {
          owner,
          key: itemKey(item),
          source: {
            repositoryKey: target.repositoryKey,
            accountId: target.accountId,
            remoteName: target.remoteName,
            kind: detail.kind,
            number: detail.number,
            url: detail.url,
            title: detail.title.slice(0, 256),
          },
          initialDraft: {
            title: detail.title.trim().slice(0, 200),
            prompt: buildForgeAgentPrompt(repository, detail),
            attachmentFiles,
          },
        };
      } finally {
        if (preparingRef.current === token) preparingRef.current = null;
        setPreparation((previous) => (previous?.token === token ? null : previous));
      }
    });
    // 修复原因：处理入口原先直接保存默认执行器；现在先打开独立草稿供用户选择。
    // 项目/Host 切换后的迟到读取不能打开旧弹窗，也不能直接创建任务。
    if (result?.value && ownerRef.current === owner) setPrepared(result.value);
  };
  const create = async (input: Omit<WorkTaskCreate, keyof WorkTaskScope>) => {
    if (
      !draft ||
      draftRef.current !== draft ||
      !rpcReady ||
      ownerRef.current !== owner ||
      !workTaskService
    )
      return false;
    const result = await mutation.run(async () => {
      const execution = input.execution;
      // 显式选择是保存依据；确认时重新核对目录，不允许失效的 ACP/API 静默回落。
      const [view, agents] = await Promise.all([
        execution.kind === "api" ? modelSelectionService.getView() : Promise.resolve(null),
        execution.kind === "acp" ? acpService.listAvailableAgents() : Promise.resolve([]),
      ]);
      // 取消与保存可能在同一轮事件内发生；草稿失效后不能让迟到校验继续写入。
      if (ownerRef.current !== owner || draftRef.current !== draft) return null;
      if (!isWorkTaskExecutionAvailable(execution, view, agents))
        throw new Error("FORGE_NO_EXECUTION");
      try {
        return await workTaskService.create({ ...input, ...scope, source: draft.source });
      } catch {
        throw new Error("FORGE_TASK_SAVE");
      }
    });
    if (!result?.value || ownerRef.current !== owner || draftRef.current !== draft) return false;
    void tasks.refresh();
    return true;
  };
  const linked = [...links.values()].filter(
    (task) => task.source?.repositoryKey === target?.repositoryKey && task.forgeWriteback,
  );
  const writebackVersion = JSON.stringify(
    linked
      .map((task) => [
        task.forgeWriteback!.id,
        task.forgeWriteback!.commentState === "done",
        task.forgeWriteback!.closeState === "done",
      ])
      .sort(),
  );
  const closedItemsKey = JSON.stringify(
    linked
      .filter((task) => task.forgeWriteback?.closeState === "done")
      .map((task) => `${task.source!.kind}:${task.source!.number}`)
      .sort(),
  );
  return {
    prepare,
    create,
    writebackVersion,
    closedItemsKey,
    draft,
    preparation: preparation?.owner === owner && mutation.busy ? preparation : null,
    cancelPreparation: () => {
      if (preparation?.owner !== owner || !preparingRef.current) return;
      preparingRef.current = null;
      setPreparation(null);
      mutation.cancel();
    },
    close: () => {
      draftRef.current = null;
      setPrepared(null);
    },
    busy: mutation.busy,
    error: mutation.error,
    isCreated,
    linkedTask,
  };
}
