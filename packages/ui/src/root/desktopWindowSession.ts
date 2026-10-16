import { create } from "zustand";
import {
  desktopWindowSessionSnapshotSchema,
  type DesktopWindowSessionSnapshot,
} from "@zcode/shared";
import { isWorkspaceTab, type TabStore } from "@/store/tabStore.js";

/** 仅为 Host 快照的 UI 投影，不拥有服务端会话或已接纳命令。 */
export const useDesktopWindowView = create<{
  following: boolean;
  snapshot: DesktopWindowSessionSnapshot | null;
}>(() => ({ following: false, snapshot: null }));

export function applyDesktopWindowSession(store: TabStore, input: unknown) {
  const snapshot = desktopWindowSessionSnapshotSchema.parse(input);
  const previous = useDesktopWindowView.getState().snapshot;
  if (previous?.epoch === snapshot.epoch && previous.revision >= snapshot.revision) return;
  const state = store.getState();
  const workspaceKey = (tab: { workspacePath: string; workspaceIdentity?: string }) =>
    tab.workspaceIdentity?.trim() || tab.workspacePath;
  const workspaces = snapshot.workspaces.map((item) => {
    const existing = state.tabs.find(
      (tab) => isWorkspaceTab(tab) && workspaceKey(tab) === workspaceKey(item),
    );
    // 保留 tab id 和手机当前草稿；严格替换 membership，不能把已关闭项目从本地历史合并回来。
    return {
      id: existing?.id ?? `desktop-window:${workspaceKey(item)}`,
      label:
        existing?.label ??
        item.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ??
        item.workspacePath,
      kind: "workspace" as const,
      ...item,
    };
  });
  const extraTabs = state.tabs.filter((tab) => !isWorkspaceTab(tab));
  const tabs = [...workspaces, ...extraTabs];
  const retainedActive = tabs.find((tab) => tab.id === state.activeTabId);
  // #180：窗口成员顺序不代表手机的启动目标。只自动进入已有本地对话工作区，
  // 没有对话工作区时保留未选择态，不能打开第一个项目或隐式创建新 runtime。
  const active =
    retainedActive ??
    workspaces.find(
      (tab) =>
        tab.workspacePurpose === "conversation" &&
        !tab.workspaceIdentity &&
        !tab.remoteSessionId &&
        tab.availability !== "unavailable-local-directory",
    );
  store.setState({
    tabs,
    activeTabId: active?.id ?? null,
    activeWorkspacePath: active && isWorkspaceTab(active) ? active.workspacePath : null,
    activeWorkspaceIdentity:
      active && isWorkspaceTab(active) ? (active.workspaceIdentity ?? null) : null,
    expandedWorkspacePaths: new Set(
      workspaces
        .filter((tab) => !previous || state.expandedWorkspacePaths.has(tab.workspacePath))
        .map((tab) => tab.workspacePath),
    ),
  });
  useDesktopWindowView.setState({ following: true, snapshot });
  return !retainedActive && active && isWorkspaceTab(active) ? active : undefined;
}
