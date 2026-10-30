import { useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import type { GitChangeSourceId, WorkTaskScope } from "@zcode/shared";
import { DialogContent } from "@/components/ui/dialog.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.js";
import { cn } from "@/components/lib/utils.js";
import { usePaneGitStatus, type OpenScopedGitReview } from "@/hooks/usePaneGitStatus.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  activateGitSidePane,
  closeSidePaneTab,
  closeVisibleOtherSidePaneTabs,
  closeVisibleSidePaneTabs,
  openCodeViewerSidePane,
  setActiveSidePaneTab,
  reorderSidePaneTab,
  type WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";
import { AgentBoardToolsPane } from "./AgentBoardToolsPane.js";

const PANEL_IDS = ["board-conversation", "board-review"];
export type AgentBoardToolActions = Omit<ReturnType<typeof usePaneGitStatus>, "gitState"> & {
  onOpenCodeViewer(source: CodeViewerSource): void;
  onOpenFileLink(target: MessageFileLinkTarget): void;
};

export function AgentBoardTools({
  scope,
  enabled,
  isDesktop,
  showCloseButton = false,
  onOpenBrowserUrl,
  children,
}: {
  scope: WorkTaskScope;
  enabled: boolean;
  isDesktop?: boolean;
  showCloseButton?: boolean;
  onOpenBrowserUrl?: (url: string) => void;
  children(actions: AgentBoardToolActions): ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const { services, remoteSessionId, rpcReady } = useWorkspaceServicesResolution(
    scope.workspacePath,
    scope.remoteSessionId,
    scope.workspaceIdentity,
    undefined,
    true,
  );
  const scopeKey = JSON.stringify([
    scope.workspaceIdentity?.trim() || scope.workspacePath,
    scope.workspacePath,
    scope.remoteSessionId ?? "",
    remoteSessionId,
    rpcReady,
    enabled,
  ]);
  const [request, setRequest] = useState<{
    scopeKey: string;
    pane: WorkspaceSidePaneState | null;
    sourceId: GitChangeSourceId;
  }>(() => ({ scopeKey, pane: null, sourceId: "unstaged" }));
  const pane = request.scopeKey === scopeKey ? request.pane : null;
  const open = Boolean(pane?.tabs.length);
  // 原回调写入看板中不可见的 Shell，文件又另开弹窗；改由当前详情统一持有工具标签。
  // scope/attachment 改变立即废弃旧标签，保留会话挂载；重连也不自动恢复旧请求。
  if (request.scopeKey !== scopeKey) setRequest({ scopeKey, pane: null, sourceId: "unstaged" });
  const updatePane = (
    update: (current: WorkspaceSidePaneState | null) => WorkspaceSidePaneState | null,
  ) =>
    setRequest((current) =>
      current.scopeKey === scopeKey ? { ...current, pane: update(current.pane) } : current,
    );
  const openReview = useCallback<OpenScopedGitReview>(
    (_scope, sourceId) => {
      if (!enabled || !rpcReady) return;
      setRequest((current) =>
        current.scopeKey === scopeKey
          ? {
              ...current,
              pane: activateGitSidePane(current.pane),
              sourceId: sourceId ?? "unstaged",
            }
          : current,
      );
    },
    [enabled, rpcReady, scopeKey],
  );
  const openCodeViewer = (source: CodeViewerSource) => {
    // 显式 source 的归属不可被当前 Shell 或详情覆盖；缺省才补当前会话完整 scope。
    const scoped = source.workspacePath
      ? source
      : {
          ...source,
          workspacePath: scope.workspacePath,
          workspaceIdentity: source.workspaceIdentity ?? scope.workspaceIdentity,
          workspaceRemoteSessionId: source.workspaceRemoteSessionId ?? scope.remoteSessionId,
        };
    updatePane((current) => openCodeViewerSidePane(current, scoped));
  };
  const reviewOpen = Boolean(pane?.tabs.some((tab) => tab.type === "git"));
  // 状态浮窗和审查共用一份 Git 投影；保留审查标签时才读取扩展数据。
  const { gitState, ...status } = usePaneGitStatus(scope, enabled, openReview, reviewOpen);
  const closeTab = (id: string) => updatePane((current) => closeSidePaneTab(current, id));
  const close = () => {
    if (pane) closeTab(pane.activeTabId);
  };
  const actions: AgentBoardToolActions = {
    ...status,
    onOpenCodeViewer: openCodeViewer,
    onOpenFileLink: (target) =>
      openCodeViewer({
        type: "file",
        title: getPathLeaf(target.path),
        path: target.path,
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
        workspaceRemoteSessionId: target.workspaceRemoteSessionId,
      }),
  };
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    // 详情打开工具时会扩宽，窄屏退回单页；按实际容器测量，不猜测平台或窗口宽度。
    const update = () => setWide(element.clientWidth >= 768);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const split = open && wide;
  return (
    <DialogContent
      ref={setElement}
      showCloseButton={showCloseButton}
      data-testid="agent-board-details"
      onOpenAutoFocus={(event) => {
        // 首个操作可能带 Tooltip；聚焦容器，避免 Esc 先被提示层消耗。
        event.preventDefault();
        if (event.target instanceof HTMLElement) event.target.focus();
      }}
      onPointerDownOutside={(event) => {
        // 分栏库在 document capture 阶段 preventDefault，Radix 因而跳过内部命中标记。
        // 只纠正仍在详情 DOM 内的误判，真正点击外部继续走原关闭行为。
        const target = event.detail.originalEvent.target;
        if (target instanceof Node && element?.contains(target)) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (open) {
          event.preventDefault();
          close();
        }
      }}
      className={cn(
        "inset-y-0 right-0 left-auto flex h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0",
        open ? "sm:max-w-none" : "sm:max-w-3xl",
      )}
    >
      <ResizablePanelGroup
        layoutId="agent-board-review-horizontal-v1"
        panelIds={PANEL_IDS}
        persistenceEnabled={split}
        disabled={!split}
        data-split={split}
        className="min-h-0 min-w-0 [&>[hidden]]:hidden! data-[split=false]:[&>[data-panel]]:flex-1!"
      >
        <ResizablePanel
          id={PANEL_IDS[0]}
          defaultSize="52%"
          minSize={split ? "380px" : "0px"}
          hidden={open && !wide}
        >
          <div
            data-testid="agent-board-conversation-column"
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
          >
            {children(actions)}
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label={intl.formatMessage({ id: "workspaceSidebar.resizeSidebar" })}
          style={!split ? { display: "none" } : undefined}
          className="aria-[orientation=vertical]:my-0 aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-1 aria-[orientation=vertical]:translate-x-0 aria-[orientation=vertical]:[mask-image:none] aria-[orientation=vertical]:[-webkit-mask-image:none] before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border"
        />
        <ResizablePanel
          id={PANEL_IDS[1]}
          defaultSize="48%"
          minSize={split ? "380px" : "0px"}
          hidden={!open}
        >
          {open && pane ? (
            <AgentBoardToolsPane
              state={pane}
              scope={scope}
              remoteSessionId={remoteSessionId ?? undefined}
              services={services}
              gitState={gitState}
              isDesktop={isDesktop}
              sourceId={request.sourceId}
              onSelectSource={(sourceId) =>
                setRequest((current) =>
                  current.scopeKey === scopeKey ? { ...current, sourceId } : current,
                )
              }
              onActivateTab={(id) => updatePane((current) => setActiveSidePaneTab(current, id))}
              onCloseTab={closeTab}
              onCloseOtherTabs={(id) =>
                updatePane((current) => closeVisibleOtherSidePaneTabs(current, id, null))
              }
              onCloseAllTabs={() =>
                updatePane((current) => closeVisibleSidePaneTabs(current, null))
              }
              onReorderTab={(activeId, overId) =>
                updatePane((current) => reorderSidePaneTab(current, activeId, overId))
              }
              onRefresh={status.onRefreshGit}
              onOpenCodeViewer={openCodeViewer}
              onOpenBrowserUrl={onOpenBrowserUrl}
            />
          ) : null}
        </ResizablePanel>
      </ResizablePanelGroup>
    </DialogContent>
  );
}
