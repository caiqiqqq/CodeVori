import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ForgeItem,
  ForgeRepository,
  ForgeTargetRequest,
  WorkTaskCreate,
  WorkTaskScope,
} from "@zcode/shared";
import { buildForgeAgentPrompt } from "@/lib/forgePanel.js";
import { isWorkTaskExecutionAvailable } from "@/store/workTaskExecutionPreferenceStore.js";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
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
  const [saved, setSaved] = useState({ owner, keys: new Set<string>() });
  const [prepared, setPrepared] = useState<{
    owner: object;
    key: string;
    initialDraft: Pick<WorkTaskCreate, "title" | "prompt">;
  } | null>(null);
  const created = saved.owner === owner ? saved.keys : new Set<string>();
  const draft = prepared?.owner === owner ? prepared : null;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const itemKey = (item: ForgeItem) => `${item.kind}:${item.number}`;
  const prepare = async (repository: ForgeRepository, item: ForgeItem) => {
    if (!target || !rpcReady || draft || created.has(itemKey(item))) return;
    const result = await mutation.run(async () => {
      if (!workTaskService) throw new Error("FORGE_TASK_UNSUPPORTED");
      const detail = await gitService.getForgeItem({
        ...target,
        kind: item.kind,
        number: item.number,
      });
      return {
        owner,
        key: itemKey(item),
        initialDraft: {
          title: detail.title.trim().slice(0, 200),
          prompt: buildForgeAgentPrompt(repository, detail),
        },
      };
    });
    // 修复原因：处理入口原先直接保存默认执行器；现在先打开独立草稿供用户选择。
    // 项目/Host 切换后的迟到读取不能打开旧弹窗，也不能直接创建任务。
    if (result && ownerRef.current === owner) setPrepared(result.value);
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
        return await workTaskService.create({ ...input, ...scope });
      } catch {
        throw new Error("FORGE_TASK_SAVE");
      }
    });
    if (!result?.value || ownerRef.current !== owner || draftRef.current !== draft) return false;
    setSaved((previous) => ({
      owner,
      keys: new Set([...(previous.owner === owner ? previous.keys : []), draft.key]),
    }));
    return true;
  };
  return {
    prepare,
    create,
    draft,
    close: () => {
      draftRef.current = null;
      setPrepared(null);
    },
    busy: mutation.busy,
    error: mutation.error,
    isCreated: (item: ForgeItem) => created.has(itemKey(item)),
  };
}
