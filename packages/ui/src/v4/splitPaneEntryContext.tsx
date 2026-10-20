// 侧栏会话项「在分屏打开 / 拖拽分屏」入口的可用性开关。
// session workbench groups 支持桌面和普通 web app；手机与 /remote web-remote
// 不启用。用 context 而不是逐层 props：会话项上下文菜单和 drag source 被多个
// 侧栏 Section 共用，判定源收敛在 WorkspaceShellLayout 一处。
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { countPanes, usePaneLayoutStore } from "@/v4/paneLayoutStore.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import type { WorkbenchSessionTarget } from "@/v4/workbenchSessionPlacement.js";

export type V4SplitPaneSessionTarget = WorkbenchSessionTarget;

interface V4SplitPaneEntryContextValue {
  readonly enabled: boolean;
  readonly canOpenSession: (target: V4SplitPaneSessionTarget) => boolean;
  readonly openSession: (target: V4SplitPaneSessionTarget) => void;
}

const DEFAULT_SPLIT_PANE_ENTRY_CONTEXT: V4SplitPaneEntryContextValue = {
  enabled: false,
  canOpenSession: () => false,
  openSession: () => {},
};

const V4SplitPaneEntryContext = createContext<V4SplitPaneEntryContextValue>(
  DEFAULT_SPLIT_PANE_ENTRY_CONTEXT,
);

export function V4SplitPaneEntryProvider({
  enabled,
  canOpenSession,
  onOpenSession,
  children,
}: {
  enabled: boolean;
  canOpenSession: (target: V4SplitPaneSessionTarget) => boolean;
  onOpenSession: (target: V4SplitPaneSessionTarget) => void;
  children: ReactNode;
}) {
  // 修复原因：菜单禁用态在 task row 渲染时计算；仅从回调里读取 getState，
  // 分屏关闭/焦点切换后侧栏不会重渲染，仍保留上一次的禁用态。
  const paneCount = usePaneLayoutStore(countPanes);
  const focusedPaneId = usePaneLayoutStore((state) => state.focusedPaneId);
  const paneBindings = usePaneLayoutStore((state) => state.panes);
  const activeGroup = useWorkbenchGroupStore((state) =>
    state.activeGroupId ? state.groups[state.activeGroupId] : undefined,
  );
  const sessionIndex = useWorkbenchGroupStore((state) => state.sessionIndex);
  const value = useMemo<V4SplitPaneEntryContextValue>(
    () => ({
      enabled,
      canOpenSession: (target) => enabled && canOpenSession(target),
      openSession: (target) => {
        if (enabled) onOpenSession(target);
      },
    }),
    [
      enabled,
      canOpenSession,
      onOpenSession,
      paneCount,
      focusedPaneId,
      paneBindings,
      activeGroup,
      sessionIndex,
    ],
  );
  return (
    <V4SplitPaneEntryContext.Provider value={value}>{children}</V4SplitPaneEntryContext.Provider>
  );
}

/** 右键入口由 shell 统一裁决，避免 task row 绕过 active group/draft pane owner。 */
export function useV4SplitPaneEntry(): V4SplitPaneEntryContextValue {
  return useContext(V4SplitPaneEntryContext);
}
