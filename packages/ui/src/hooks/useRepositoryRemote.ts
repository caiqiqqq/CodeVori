import { useCallback } from "react";
import { useStore } from "zustand";
import { repositoryNavigationStore } from "@/store/repositoryNavigationStore.js";

export function useRepositoryRemote(workspacePath: string, workspaceIdentity?: string) {
  // remote 原先随面板卸载被清空；hook 统一读写 workspace 身份隔离的唯一偏好 owner。
  const key = workspaceIdentity?.trim() || workspacePath;
  const remoteName = useStore(repositoryNavigationStore, (state) => state.remotes[key]);
  const selectRemote = useCallback(
    (name: string) =>
      repositoryNavigationStore.getState().selectRemote({ workspacePath, workspaceIdentity }, name),
    [workspacePath, workspaceIdentity],
  );
  return { remoteName, selectRemote };
}
