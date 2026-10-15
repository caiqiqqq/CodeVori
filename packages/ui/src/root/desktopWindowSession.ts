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

export function applyDesktopWindowSession(store: TabStore, input: unknown): void {
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
  const active = tabs.find((tab) => tab.id === state.activeTabId) ?? workspaces[0] ?? extraTabs[0];
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
}
