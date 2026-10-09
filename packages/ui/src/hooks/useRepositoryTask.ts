import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ForgeItem, ForgeRepository, ForgeTargetRequest, WorkTaskScope } from "@zcode/shared";
import { buildForgeAgentPrompt } from "@/lib/forgePanel.js";
import {
  resolveWorkTaskExecutionPreference,
  workTaskExecutionPreferenceStore,
} from "@/store/workTaskExecutionPreferenceStore.js";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { useForgeMutation } from "./useForgeMutation.js";

/** Saves through the repository's Host; accepted task state stays in WorkTaskService. */
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
  const created = saved.owner === owner ? saved.keys : new Set<string>();
  const itemKey = (item: ForgeItem) => `${item.kind}:${item.number}`;
  const create = async (repository: ForgeRepository, item: ForgeItem) => {
    if (!target || !rpcReady || created.has(itemKey(item))) return;
    const result = await mutation.run(async () => {
      if (!workTaskService) throw new Error("FORGE_TASK_UNSUPPORTED");
      const remembered = workTaskExecutionPreferenceStore.getState().read(scope);
      const [detail, view, agents] = await Promise.all([
        gitService.getForgeItem({ ...target, kind: item.kind, number: item.number }),
        modelSelectionService.getView(),
        remembered?.kind === "acp" ? acpService.listAvailableAgents() : Promise.resolve([]),
      ]);
      // 切换项目/Host 后旧读取可能迟到；写入前核对 owner，避免给旧项目意外新增待办。
      if (ownerRef.current !== owner) return null;
      const execution = resolveWorkTaskExecutionPreference(remembered, view, agents);
      if (!execution) throw new Error("FORGE_NO_EXECUTION");
      try {
        return await workTaskService.create({
          ...scope,
          title: detail.title.trim().slice(0, 200),
          prompt: buildForgeAgentPrompt(repository, detail),
          execution,
        });
      } catch {
        throw new Error("FORGE_TASK_SAVE");
      }
    });
    if (result?.value && ownerRef.current === owner)
      setSaved((previous) => ({
        owner,
        keys: new Set([...(previous.owner === owner ? previous.keys : []), itemKey(item)]),
      }));
  };
  return {
    create,
    busy: mutation.busy,
    error: mutation.error,
    isCreated: (item: ForgeItem) => created.has(itemKey(item)),
  };
}
