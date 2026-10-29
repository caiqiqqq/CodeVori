/* eslint-disable max-lines -- workspace shell 当前集中编排 sidebar、chat、terminal 和 browser pane 的布局联动，先保持单文件收口，避免为满足行数限制打散关键布局状态。*/
import { PRODUCT_NAME } from "@zcode/shared";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { TID_APP_HEADER } from "@zcode/shared";
// 保活：workspace tab 真正关闭时，按 workspaceKey 回收 side pane terminal 的常驻 PTY/xterm。
// 对称下侧 Terminal.tsx 的 openWorkspaceKeys 回收。
import { sidePaneTerminalSessionRegistry } from "@/terminal/sidePaneTerminalSessionRegistry.js";
import { V4ChatPane } from "@/v4/V4ChatPane.js";
import { V4WorkspaceChatArea } from "@/v4/V4WorkspaceChatArea.js";
import {
  V4SplitPaneEntryProvider,
  type V4SplitPaneSessionTarget,
} from "@/v4/splitPaneEntryContext.js";
import {
  WorkflowRunOpenProvider,
  type WorkflowRunOpenTarget,
} from "@/v4/workflowRunOpenContext.js";
import type { ConversationDropTargetController } from "@/v4/composer/conversationDropTarget.js";
import type { WorkbenchSessionBinding } from "@/v4/workbenchGroupStore.js";
import {
  buildPrimaryWorkbenchSessionBinding,
  canPlaceWorkbenchSessionInSplit,
  placeWorkbenchSessionInSplit,
  selectWorkbenchSession,
} from "@/v4/workbenchSessionPlacement.js";
import { usePaneSessionPersistence } from "@/v4/usePaneSessionPersistence.js";
import { useDesktopWindowNavigation } from "@/hooks/useDesktopWindowNavigation.js";
import { useDesktopWindowView } from "@/root/desktopWindowSession.js";
import { requestV4ComposerDraftWorkspaceTransfer } from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import {
  WorktreeDraftIntentContext,
  type WorktreeAutoSendRequest,
} from "@/v4/composer/worktreeDraftIntent.js";
import {
  persistV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import type { AcpAgent } from "@zcode/shared";
import { useWorktreeDraftSelection } from "@/hooks/useWorktreeDraftSelection.js";
import { useWorktreeSettingsConversation } from "@/hooks/useWorktreeSettingsConversation.js";
import { ChatEmptyWorkspacePreviewMenu } from "@/ChatEmptyState.js";
import { DesktopTopOverlay } from "@/DesktopTopOverlay.js";
import { DesktopWindowFrame } from "@/DesktopWindowFrame.js";
import { WorkspacePluginPreview } from "@/WorkspacePluginPreview.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { GitBranchSwitcher } from "@/GitBranchSwitcher.js";
import { ScopedErrorBoundary } from "@/ErrorBoundary.js";

import { AUTOMATIONS_TOAST_ANCHOR_ID, AutomationsSection } from "@/settings/AutomationsSection.js";
import type {
  SavedWorkflowLaunchTarget,
  SavedWorkflowsOpenArtifactParams,
  SavedWorkflowsOpenRunParams,
} from "@/settings/saved-workflows/SavedWorkflowsSection.js";
import { AutomationsMainBreadcrumbFrame } from "@/settings/AutomationsMainBreadcrumbFrame.js";
import { PluginStorePage } from "@/settings/PluginStorePage.js";
import { TaskFindDialog } from "@/quickpick/TaskFindDialog.js";
import { CommandCenterDialog } from "@/command-center/CommandCenterDialog.js";
import { WorkspaceHeader } from "@/WorkspaceHeader.js";
import { WorkspaceSidebar, type SidebarFileTreeOpenRequest } from "@/WorkspaceSidebar.js";

import type {
  AcpSidebarSession,
  AcpConversationOpenRequest,
  AcpConversationProjection,
} from "@/lib/acpSidebarSessions.js";
import { AnimatedSidePanePanel } from "@/app-shell/AnimatedSidePanePanel.js";
import {
  findScreenshotSurfaceTabForRender,
  useBrowserScreenshotSurfaceRequest,
} from "@/browser-use/useBrowserScreenshotSurfaceRequest.js";
import { AnimatedTerminalPanel } from "@/app-shell/AnimatedTerminalPanel.js";
import { SIDE_PANE_DEFAULT_EXPANDED_SIZE } from "@/app-shell/sidePaneLayout.js";
import { useAnimatedResizablePanel } from "@/app-shell/useAnimatedResizablePanel.js";
import { ensureTaskNavigationWorkspace } from "@/app-shell/taskNavigationWorkspace.js";

import {
  resolveWorkspaceShellPanelRadiusPx,
  resolveWorkspaceShellResizeHandleInsetPx,
  resolveWorkspaceShellWindowChromeClass,
} from "@/app-shell/workspaceShellWindowChrome.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.js";
import { toast } from "@/components/ui/toast.js";
import { getGitDirtyFileCount } from "@/git-branch-switcher/display.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { getPathLeaf, toFileUrl } from "@/lib/path.js";
import { shouldOpenAssistantHtmlInBrowser } from "@/lib/assistantPreviewCards.js";
import { setWorkspaceSidebarResizeActive } from "@/lib/workspaceSidebarResizeState.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import {
  addWorkspacePathOpenRequestListener,
  selectWorkspacePathFileService,
  shouldFallbackWorkspacePathToCodeViewer,
  type WorkspacePathOpenRequest,
} from "@/lib/workspacePathNavigation.js";
import {
  buildSelectionSideChatKey,
  requestSelectionSideChatOpen,
} from "@/lib/selectionSideChatRuntime.js";
import { getActiveSelectionSideChatTab } from "@/lib/workspaceSidePane.js";
import { logger } from "@/logger.js";
import {
  areWorkspaceFilePathsEqual,
  isWorkspaceFilePathInside,
} from "@/workspace-file-tree/model.js";
import type { WorkspaceShellLayoutProps } from "@/app-shell/types.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { ComposerMentionPrefill } from "@/store/zcodeSessionStoreTypes.js";

const RepositoryPanel = lazy(() =>
  import("@/repository-panel/RepositoryPanel.js").then((module) => ({
    default: module.RepositoryPanel,
  })),
);
const AgentBoardPanel = lazy(() =>
  import("@/agent-board/AgentBoardPanel.js").then((module) => ({
    default: module.AgentBoardPanel,
  })),
);
const WorkTasksPanel = lazy(() =>
  import("@/work-tasks/WorkTasksPanel.js").then((module) => ({ default: module.WorkTasksPanel })),
);

const WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX = 264;
const WORKSPACE_SIDEBAR_MIN_WIDTH_PX = 264;
const WORKSPACE_SIDEBAR_MAX_WIDTH_RATIO = 0.5;
const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = "zcode:workspace-shell:sidebar-width-px";
const LEGACY_WORKSPACE_SHELL_LAYOUT_STORAGE_KEY =
  "react-resizable-panels:workspace-shell-layout:sidebar:content";
const WORKSPACE_SIDEBAR_RESIZE_KEYBOARD_STEP_PX = 16;
const WORKSPACE_SIDEBAR_PANEL_WIDTH_CSS_VAR = "--workspace-sidebar-panel-width";
const WORKSPACE_SIDEBAR_WIDTH_CSS_VAR = "--workspace-sidebar-width";
const CONVERSATION_AUTO_COLLAPSE_SIDE_PANE_WIDTH_PX = 480;
// WorkspaceShellLayout 是 memo 组件，默认 []/{} 会在缺省调用时每次创建新引用；
// 入口缺省这些集合时复用常量，避免浅比较误判 props 变化。
const EMPTY_RECONNECTING_REMOTE_WORKSPACE_LOGS_BY_WORKSPACE_KEY: NonNullable<
  WorkspaceShellLayoutProps["reconnectingRemoteWorkspaceLogsByWorkspaceKey"]
> = {};
const EMPTY_REMOTE_WORKSPACE_SESSIONS: NonNullable<
  WorkspaceShellLayoutProps["remoteWorkspaceSessions"]
> = [];
const CONVERSATION_AUTO_COLLAPSE_SIDEBAR_WIDTH_PX = 360;
const CONVERSATION_AUTO_COLLAPSE_RESIZE_IDLE_MS = 300;
const MOBILE_WORKSPACE_AUTO_COLLAPSE_WIDTH_PX = 768;
// 性能修复：ResizablePanelGroup 收到深相等的新 panelIds 数组，
// 会跟随 chat streaming render 重算布局上下文；固定数组语义上不会随消息变化。
const WORKSPACE_BODY_PANEL_IDS = ["conversation-column", "browser"];
const WORKSPACE_CONVERSATION_PANEL_IDS = ["conversation", "terminal"];

type WorkspaceSidebarResizeSession = {
  containerWidthPx: number;
  pointerId: number;
  startWidthPx: number;
  startX: number;
};

function clampWorkspaceSidebarWidth(widthPx: number, containerWidthPx?: number) {
  const maxWidthPx =
    containerWidthPx && containerWidthPx > 0
      ? Math.max(
          WORKSPACE_SIDEBAR_MIN_WIDTH_PX,
          containerWidthPx * WORKSPACE_SIDEBAR_MAX_WIDTH_RATIO,
        )
      : Number.POSITIVE_INFINITY;

  return Math.round(Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH_PX, Math.min(widthPx, maxWidthPx)));
}

function readStoredWorkspaceSidebarWidthPx(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? clampWorkspaceSidebarWidth(parsed) : null;
  } catch {
    return null;
  }
}

function readLegacyWorkspaceSidebarWidthRatio(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_WORKSPACE_SHELL_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { sidebar?: unknown };
    const ratio = Number(parsed.sidebar);
    return Number.isFinite(ratio) && ratio > 0 ? ratio / 100 : null;
  } catch {
    return null;
  }
}

function persistWorkspaceSidebarWidthPx(widthPx: number) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
  } catch {
    // ignore
  }
}

export const WorkspaceShellLayout = memo(function WorkspaceShellLayoutComponent({
  commandCenterOpen,
  commandCenterCommands,
  commandCenterWorkspaceTabs,
  onCommandCenterOpenChange,
  onCommandCenterSearchResultHighlightRequest,
  onCommandCenterOpenCodeViewer,
  services,
  workspaceReadOnlyReason,
  workspaceMainView,
  workTaskTools,
  pluginStoreOpenVersion,
  openAutomationId,
  openAutomationTab,
  onWorkspaceMainViewChange,
  onOpenAutomationConsumed,
  handleOpenAutomations,
  handleOpenPluginStore,
  handleOpenRepository,
  handleOpenWorkTasks,
  handleOpenAgentBoard,
  handleManageInstalledPlugins,
  onConnectRemote,
  onSelectRemoteProject,
  onCancelRemoteProject,
  onReconnectRemoteWorkspace,
  onLogout,
  user,
  reconnectingRemoteWorkspaceKeys,
  remoteWorkspaceErrorByWorkspaceKey,
  reconnectingRemoteWorkspaceLogsByWorkspaceKey = EMPTY_RECONNECTING_REMOTE_WORKSPACE_LOGS_BY_WORKSPACE_KEY,
  onCreateTask,
  onCreateConversationTask,
  onResolveConversationWorkspace,
  onOpenWorkspace,
  onOpenWorkspacePath,
  onOpenFolderFromWorkspaceMenu,
  onOpenRemoteWorkspace,
  onCreateScratchWorkspace,
  allowOpenWorkspace = true,
  allowRemoteWorkspace = true,
  remoteWorkspaceSessions = EMPTY_REMOTE_WORKSPACE_SESSIONS,
  workspaceAbsPath,
  workspaceRemoteSessionId,
  workspaceIdentity,
  isWorkspaceVisible = true,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  workspaceShellZCodeState,
  theme,
  isMacFullscreen,
  desktopWindowChromeState,
  macWindowControlsLeftPaddingPx,
  windowsWindowControlsRightPaddingPx = 136,
  updateReadyVersion,
  updateState,
  sidebarContainerRef,
  toggleSidebarShortcutLabel,
  newTaskShortcutLabel,
  goBackShortcutLabel,
  goForwardShortcutLabel,
  toggleSidePaneShortcutLabel,
  canGoBack,
  canGoForward,
  canTaskNavBack,
  canTaskNavForward,
  isTerminalOpen,
  isSidebarVisible,
  isSidePaneOpen,
  isBrowserOpen,
  supportsEmbeddedBrowser,
  summaryPanelVariantOverride,
  onSummaryPanelVariantOverrideChange,
  sidePaneState,
  recentClosedSidePaneTabs,
  projectName,
  workspaceTabs,
  activeTaskId,
  sidePaneOwnerId,
  activeTraceId,
  activeSessionId,
  activeTaskProvider,
  resolvedActiveTaskMeta,
  activeTaskTitle,
  activeTaskChangeSummary,
  gitWorktreeReviewSourceId,
  gitWorktreeChangeSummary,
  activeGitSourceId,
  gitState,
  browserNavigationRequest,
  browserRestoreUrls,
  taskNativeSessionLogFile,
  taskSessionFile,
  testMessages,
  conversationFindActiveIndex,
  conversationFindNavigationRequestId,
  conversationFindQuery,
  onConversationFindMatchStateChange,
  searchResultHighlightRequest,
  onSearchResultHighlightDone,
  fileChangeFindActiveIndex,
  fileChangeFindNavigationRequestId,
  fileChangeFindQuery,
  onFileChangeFindMatchCountChange,
  platform,
  reloadSessionDisabled,
  reloadSessionPending,
  handleReloadSession,
  handleSelectTask,
  handleTaskNavBack,
  handleTaskNavForward,
  handleStartDraftInWorkspace,
  handleOpenCommandCenter,
  handleRefreshGit,
  handleBrowserUrlChange,
  handleBrowserPageMetadataChange,
  handleToggleSidebar,
  handleToggleTerminal,
  handleToggleBrowser,
  handleOpenBrowserTab,
  handleOpenTreemapping,
  handleOpenWhiteboard,
  handleOpenDeveloperTools,
  handleOpenTerminalTab,
  handleToggleGit,
  handleOpenGitReview,
  handleOpenScopedGitReview,
  handleToggleSidePane,
  handleOpenBrowserUrl,
  handleOpenCodeViewer,
  handleAutoOpenAssistantPptx,
  handleOpenSubagentSession,
  handleOpenBackgroundBash,
  handleOpenSubagentDirectory,
  handleSyncSubagentSessionTabs,
  handleOpenSelectionSideChat,
  handleOpenPlanDetail,
  handleOpenWorkflowRun,
  handleOpenWorkflowRunDirectory,
  handleOpenWorkflowActorSession,
  handleOpenWorkflowWorkspace,
  handleOpenWorkflowArtifact,
  handleCloseCodeViewer,
  handleCloseGit,
  handleActivateSidePaneTab,
  handleReorderSidePaneTab,
  handleCloseSidePaneTab,
  handleCloseOtherSidePaneTabs,
  handleCloseAllSidePaneTabs,
  handleReopenClosedSidePaneTab,
  handleBrowserNavigationRequestHandled,
  setIsTerminalOpen,
  setGitSelectedSourceId,
  taskFindDialogProps,
}: WorkspaceShellLayoutProps) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const baseServices = useBaseWorkspaceServices();
  const tabStoreApi = useTabStoreApi();
  const workTaskToolTarget = workspaceMainView === "work-tasks" ? workTaskTools?.target : null;
  const panelWorkspacePath = workTaskToolTarget?.workspacePath ?? workspaceAbsPath;
  const panelWorkspaceIdentity = workTaskToolTarget
    ? workTaskToolTarget.workspaceIdentity
    : workspaceIdentity;
  const panelRemoteSessionId = workTaskToolTarget
    ? workTaskToolTarget.remoteSessionId
    : workspaceRemoteSessionId;
  const panelWorkspaceKey = panelWorkspaceIdentity?.trim() || panelWorkspacePath;
  const panelActiveTaskId = workTaskToolTarget ? workTaskToolTarget.nativeSessionId : activeTaskId;
  const panelOwnerId = workTaskToolTarget?.sidePaneOwnerId ?? sidePaneOwnerId;
  const panelServices = workTaskToolTarget ? (workTaskTools?.services ?? services) : services;
  const panelReadOnlyReason = workTaskToolTarget
    ? workTaskTools?.readOnlyReason
    : workspaceReadOnlyReason;
  const hasWorkspaceToolsView = workspaceMainView === "chat" || Boolean(workTaskToolTarget);
  const [workTaskReviewContainer, setWorkTaskReviewContainer] = useState<HTMLElement | null>(null);
  const isLinuxDesktop = Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop);
  // Windows/Linux 也需要外层留白，避免独立面板贴住窗口边缘；桌面统一使用 4px 间距。
  const hasDesktopPanelInset = isMacDesktop || isWindowsDesktop || isLinuxDesktop;
  const usesInlineWindowControls = Boolean(isWindowsDesktop || isLinuxDesktop);
  const workspaceShellRadiusOptions = {
    isMacDesktop,
    isWindowsDesktop,
    isLinuxDesktop,
    macOSMajorVersion: desktopWindowChromeState?.macOSMajorVersion,
  };
  const workspacePanelRadiusPx = resolveWorkspaceShellPanelRadiusPx(workspaceShellRadiusOptions);
  const workspaceResizeHandleInsetPx = resolveWorkspaceShellResizeHandleInsetPx(
    workspaceShellRadiusOptions,
  );
  const collapsedSidebarWidthPx = hasDesktopPanelInset ? 4 : 0;
  const [draftHeaderDropTargetController, setDraftHeaderDropTargetController] =
    useState<ConversationDropTargetController | null>(null);
  const [conversationTabsContainer, setConversationTabsContainer] = useState<HTMLDivElement | null>(
    null,
  );
  // 壳只读当前 Host 会话投影；选择请求也只路由到 pane，ACP 身份不进入原生 task store。
  const [acpSessionProjection, setAcpSessionProjection] = useState<{
    workspaceKey: string;
    taskId: string | null;
    draftFocusVersion: number;
    session: AcpConversationProjection;
  } | null>(null);
  const [acpOpenRequest, setAcpOpenRequest] = useState<
    (AcpConversationOpenRequest & { draftFocusVersion: number }) | null
  >(null);
  const acpOpenRequestIdRef = useRef(0);
  const fileTreeOpenRequestIdRef = useRef(0);
  const [fileTreeOpenRequest, setFileTreeOpenRequest] = useState<SidebarFileTreeOpenRequest | null>(
    null,
  );
  const [isSidebarFileTreeOpen, setIsSidebarFileTreeOpen] = useState(false);
  const workspaceKey = workspaceIdentity?.trim() || workspaceAbsPath;
  const followingDesktopWindow = useDesktopWindowView((state) => state.following);
  const handlePrimaryAcpSessionChange = useCallback(
    (session: AcpConversationProjection | null) => {
      setAcpSessionProjection((previous) => {
        if (!session) {
          return previous?.workspaceKey === workspaceKey &&
            previous.taskId === activeTaskId &&
            previous.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion
            ? null
            : previous;
        }
        if (
          previous?.workspaceKey === workspaceKey &&
          previous.taskId === activeTaskId &&
          previous.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion &&
          previous.session.id === session.id &&
          previous.session.title === session.title
        )
          return previous;
        return {
          workspaceKey,
          taskId: activeTaskId,
          draftFocusVersion: workspaceShellZCodeState.draftFocusVersion,
          session,
        };
      });
    },
    [activeTaskId, workspaceKey, workspaceShellZCodeState.draftFocusVersion],
  );
  const visibleAcpSession =
    acpSessionProjection?.workspaceKey === workspaceKey &&
    acpSessionProjection.taskId === activeTaskId &&
    acpSessionProjection.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion
      ? acpSessionProjection.session
      : null;
  const handlePrimaryAcpSessionArchived = useCallback(
    (archivedSessionId: string) => {
      // 修复原因：旧打开请求留在 shell 时，pane 重挂载会重新选中刚归档的 ACP 对话。
      setAcpOpenRequest((previous) =>
        previous?.session.id === archivedSessionId &&
        previous.session.workspacePath === workspaceAbsPath &&
        (previous.session.workspaceIdentity?.trim() || previous.session.workspacePath) ===
          workspaceKey
          ? null
          : previous,
      );
      setAcpSessionProjection((previous) =>
        previous?.workspaceKey === workspaceKey &&
        previous.taskId === activeTaskId &&
        previous.session.id === archivedSessionId
          ? null
          : previous,
      );
    },
    [activeTaskId, workspaceAbsPath, workspaceKey],
  );
  const acpHeaderTitle = visibleAcpSession?.title ?? null;
  const screenshotSurfaceRequest = useBrowserScreenshotSurfaceRequest(sidePaneState?.tabs ?? []);
  const screenshotSurfaceTab = screenshotSurfaceRequest
    ? findScreenshotSurfaceTabForRender(sidePaneState?.tabs ?? [], screenshotSurfaceRequest)
    : undefined;
  // v4 pane 绑定持久化（输出中刷新恢复）：renderer 刷新后恢复上次选中的
  // session；CLI/host 进程未死，pane 重订阅即拿 snapshot+续流。
  usePaneSessionPersistence({
    workspaceKey,
    activeSessionId: activeTaskId,
    draftFocusVersion: workspaceShellZCodeState.draftFocusVersion,
    enabled: !followingDesktopWindow,
    selectSession: (sessionId) => handleSelectTask(workspaceAbsPath, sessionId, workspaceIdentity),
  });
  const workspaceShellRef = useRef<HTMLDivElement | null>(null);
  const workspaceSidebarPanelElementRef = useRef<HTMLDivElement | null>(null);
  const conversationPanelElementRef = useRef<HTMLDivElement | null>(null);
  const conversationAutoCollapseStateRef = useRef({
    handleToggleSidebar,
    handleToggleSidePane,
    isSidebarVisible,
    isSidePaneOpen,
    workspaceKey,
  });
  const conversationAutoCollapseResizeTimerRef = useRef<number | null>(null);
  const workspaceSidebarResizeSessionRef = useRef<WorkspaceSidebarResizeSession | null>(null);
  const [workspaceSidebarPanelWidthPx, setWorkspaceSidebarPanelWidthPx] = useState(
    () => readStoredWorkspaceSidebarWidthPx() ?? WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX,
  );
  const workspaceSidebarPanelWidthPxRef = useRef(workspaceSidebarPanelWidthPx);
  const openWorkspaceKeys = useMemo(() => {
    const keys = workspaceTabs.map((tab) => tab.workspaceIdentity?.trim() || tab.workspacePath);
    // 待办工作树未必打开项目 tab；当前工具目录也必须保活，不能刚创建 PTY 就回收。
    if (workTaskToolTarget) keys.push(panelWorkspaceKey);
    return keys;
  }, [workspaceTabs, workTaskToolTarget, panelWorkspaceKey]);
  // 保活回收：workspace tab 真正关闭（从 openWorkspaceKeys 移除）时，回收属于该 workspace 的
  // side pane terminal 常驻 session（杀 PTY + 销 xterm），避免孤儿进程泄漏。
  // 切 workspace 不会让 workspaceKey 离开这个集合，所以保活的 session 不受影响。
  // 对称下侧 Terminal.tsx:145-177 的 openWorkspaceKeys 回收逻辑。
  useEffect(() => {
    const retained = new Set(openWorkspaceKeys);
    sidePaneTerminalSessionRegistry.releaseByPredicate(
      (entry) => Boolean(entry.workspaceKey) && !retained.has(entry.workspaceKey),
    );
  }, [openWorkspaceKeys]);
  const isSidebarPanelVisible = isSidebarVisible;
  const {
    panelRef: terminalPanelRef,
    panelElementRef: terminalPanelElementRef,
    isVisible: isTerminalVisible,
  } = useAnimatedResizablePanel({
    open: hasWorkspaceToolsView && isTerminalOpen,
    expandedSize: "30%",
    rememberExpandedSize: true,
  });
  const {
    panelRef: sidePanePanelRef,
    panelElementRef: sidePanePanelElementRef,
    isVisible: isSidePaneVisible,
  } = useAnimatedResizablePanel({
    // 截图 surface 由 browser-use tab 自己的 fixed 承载层提供尺寸，不能再把整个右侧
    // ResizablePanel 撑开；否则自动化页会闪出空白的 tab 栏，且面板过渡期间 guest surface
    // 仍可能被 Chromium 判定为不可合成。
    open: hasWorkspaceToolsView && isSidePaneOpen,
    expandedSize: SIDE_PANE_DEFAULT_EXPANDED_SIZE,
    rememberExpandedSize: true,
    resizeOnInitialVisibleMount: false,
  });
  const workspaceSessionActionDisabled =
    Boolean(workspaceReadOnlyReason) || reloadSessionDisabled || reloadSessionPending;
  // 文件树打开时任务列表整屏滑出，侧栏里的 New Task 入口也随之不可见。
  // 顶部浮层需要临时露出 New Task，关闭文件树后继续沿用侧栏收起态规则。
  const showTopOverlayNewTaskButton = !isSidebarVisible || isSidebarFileTreeOpen;
  const workspaceSidebarResizeLabel = intl.formatMessage({
    id: "workspaceSidebar.resizeSidebar",
  });

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const shellElement = workspaceShellRef.current;
    if (!shellElement) return;

    let previousWidthPx: number | null = null;
    const collapseOnNarrowEntry = () => {
      const widthPx = shellElement.getBoundingClientRect().width;
      if (!Number.isFinite(widthPx) || widthPx <= 0) return;

      const enteredNarrowWorkspace =
        widthPx < MOBILE_WORKSPACE_AUTO_COLLAPSE_WIDTH_PX &&
        (previousWidthPx === null || previousWidthPx >= MOBILE_WORKSPACE_AUTO_COLLAPSE_WIDTH_PX);
      previousWidthPx = widthPx;

      const state = conversationAutoCollapseStateRef.current;
      if (!enteredNarrowWorkspace || !state.isSidebarVisible) return;

      // 手机 Web 初始布局没有可拖拽的桌面侧栏空间；复用既有 toggle，保留唯一状态所有者。
      logger.info("[WorkspaceShellLayout] narrow workspace 进入，自动收起侧栏", {
        widthPx: Math.round(widthPx),
        thresholdPx: MOBILE_WORKSPACE_AUTO_COLLAPSE_WIDTH_PX,
        workspaceKey: state.workspaceKey,
      });
      state.handleToggleSidebar();
    };

    collapseOnNarrowEntry();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(collapseOnNarrowEntry) : null;
    observer?.observe(shellElement);
    return () => observer?.disconnect();
  }, [workspaceKey]);

  useEffect(() => {
    conversationAutoCollapseStateRef.current = {
      handleToggleSidebar,
      handleToggleSidePane,
      isSidebarVisible,
      isSidePaneOpen,
      workspaceKey,
    };
  }, [handleToggleSidebar, handleToggleSidePane, isSidebarVisible, isSidePaneOpen, workspaceKey]);

  useEffect(() => {
    if (workspaceMainView !== "chat") {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const readConversationWidthPx = () =>
      conversationPanelElementRef.current?.getBoundingClientRect().width ?? null;

    const collapseSidebarIfStillNarrow = () => {
      const widthPx = readConversationWidthPx();
      if (widthPx === null) {
        return;
      }

      const {
        handleToggleSidebar: collapseSidebar,
        isSidebarVisible: latestIsSidebarVisible,
        workspaceKey: latestWorkspaceKey,
      } = conversationAutoCollapseStateRef.current;

      if (latestIsSidebarVisible && widthPx < CONVERSATION_AUTO_COLLAPSE_SIDEBAR_WIDTH_PX) {
        logger.info("[WorkspaceShellLayout] conversation 过窄，自动收起左侧栏", {
          widthPx: Math.round(widthPx),
          thresholdPx: CONVERSATION_AUTO_COLLAPSE_SIDEBAR_WIDTH_PX,
          workspaceKey: latestWorkspaceKey,
        });
        collapseSidebar();
      }
    };

    const runAutoCollapseForWindowResize = () => {
      const widthPx = readConversationWidthPx();
      if (widthPx === null) {
        return;
      }

      const {
        handleToggleSidePane: collapseSidePane,
        isSidePaneOpen: latestIsSidePaneOpen,
        workspaceKey: latestWorkspaceKey,
      } = conversationAutoCollapseStateRef.current;

      // 功能说明：自动收起只响应用户改变窗口尺寸后的 conversation 实际宽度。
      // 不监听 conversation 自身 ResizeObserver，避免用户手动打开面板时又被策略关回去。
      if (latestIsSidePaneOpen && widthPx < CONVERSATION_AUTO_COLLAPSE_SIDE_PANE_WIDTH_PX) {
        logger.info("[WorkspaceShellLayout] conversation 过窄，自动收起右侧面板", {
          widthPx: Math.round(widthPx),
          thresholdPx: CONVERSATION_AUTO_COLLAPSE_SIDE_PANE_WIDTH_PX,
          workspaceKey: latestWorkspaceKey,
        });
        collapseSidePane();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(collapseSidebarIfStillNarrow);
        });
        return;
      }

      collapseSidebarIfStillNarrow();
    };

    const handleWindowResize = () => {
      if (conversationAutoCollapseResizeTimerRef.current !== null) {
        window.clearTimeout(conversationAutoCollapseResizeTimerRef.current);
      }

      // 大会话 resize trace 显示自动收起侧栏会触发 WorkspaceSidebar
      // 和大量 tooltip/menu 子树重渲染；拖拽窗口过程中先等 resize idle，再保留原收起语义。
      conversationAutoCollapseResizeTimerRef.current = window.setTimeout(() => {
        conversationAutoCollapseResizeTimerRef.current = null;
        runAutoCollapseForWindowResize();
      }, CONVERSATION_AUTO_COLLAPSE_RESIZE_IDLE_MS);
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      if (conversationAutoCollapseResizeTimerRef.current !== null) {
        window.clearTimeout(conversationAutoCollapseResizeTimerRef.current);
        conversationAutoCollapseResizeTimerRef.current = null;
      }
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [workspaceMainView]);

  useEffect(() => {
    workspaceSidebarPanelWidthPxRef.current = workspaceSidebarPanelWidthPx;
  }, [workspaceSidebarPanelWidthPx]);

  const applyWorkspaceSidebarWidthDuringDrag = useCallback(
    (nextWidthPx: number) => {
      workspaceSidebarPanelWidthPxRef.current = nextWidthPx;
      const shellElement = workspaceShellRef.current;
      if (!shellElement) {
        return;
      }

      // 大会话 trace 显示拖拽侧栏时每个 pointermove 都 setState，
      // 会让 WorkspaceShellLayout、WorkspaceSidebar 和 ChatView 大树反复 render。
      // 拖拽中的宽度只是瞬时布局值，直接写 CSS 变量；释放时再提交 React state。
      shellElement.style.setProperty(
        WORKSPACE_SIDEBAR_PANEL_WIDTH_CSS_VAR,
        `${isSidebarPanelVisible ? nextWidthPx : collapsedSidebarWidthPx}px`,
      );
      shellElement.style.setProperty(WORKSPACE_SIDEBAR_WIDTH_CSS_VAR, `${nextWidthPx}px`);
    },
    [collapsedSidebarWidthPx, isSidebarPanelVisible],
  );

  useEffect(() => {
    if (readStoredWorkspaceSidebarWidthPx() !== null) {
      return;
    }

    const legacyRatio = readLegacyWorkspaceSidebarWidthRatio();
    const shellElement = workspaceShellRef.current;
    if (legacyRatio === null || !shellElement) {
      return;
    }

    const containerWidthPx = shellElement.getBoundingClientRect().width;
    if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) {
      return;
    }

    // 外层 workspace shell 不再使用 react-resizable-panels，
    // 但旧版本已持久化过 sidebar/content 百分比。迁移成像素宽度后，
    // 普通窗口 resize 不会再触发 RRP layout store，同时仍保留用户拖出的侧栏宽度。
    const migratedWidthPx = clampWorkspaceSidebarWidth(
      containerWidthPx * legacyRatio,
      containerWidthPx,
    );
    workspaceSidebarPanelWidthPxRef.current = migratedWidthPx;
    setWorkspaceSidebarPanelWidthPx(migratedWidthPx);
    persistWorkspaceSidebarWidthPx(migratedWidthPx);
  }, []);

  const applyWorkspaceSidebarWidth = useCallback(
    (nextWidthPx: number, options: { persist: boolean }) => {
      const containerWidthPx = workspaceShellRef.current?.getBoundingClientRect().width;
      const resolvedWidthPx = clampWorkspaceSidebarWidth(nextWidthPx, containerWidthPx);
      workspaceSidebarPanelWidthPxRef.current = resolvedWidthPx;
      setWorkspaceSidebarPanelWidthPx((currentWidthPx) =>
        currentWidthPx === resolvedWidthPx ? currentWidthPx : resolvedWidthPx,
      );
      if (options.persist) {
        persistWorkspaceSidebarWidthPx(resolvedWidthPx);
      }
      return resolvedWidthPx;
    },
    [],
  );

  const handleWorkspaceSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isSidebarPanelVisible || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }

      const shellElement = workspaceShellRef.current;
      if (!shellElement) {
        return;
      }

      const containerWidthPx = shellElement.getBoundingClientRect().width;
      workspaceSidebarResizeSessionRef.current = {
        containerWidthPx,
        pointerId: event.pointerId,
        startWidthPx: workspaceSidebarPanelWidthPxRef.current,
        startX: event.clientX,
      };
      setWorkspaceSidebarResizeActive({
        active: true,
        panelElement: workspaceSidebarPanelElementRef.current,
        shellElement,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [isSidebarPanelVisible],
  );

  const handleWorkspaceSidebarResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeSession = workspaceSidebarResizeSessionRef.current;
      if (!resizeSession || resizeSession.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const nextWidthPx = clampWorkspaceSidebarWidth(
        resizeSession.startWidthPx + event.clientX - resizeSession.startX,
        resizeSession.containerWidthPx,
      );
      applyWorkspaceSidebarWidthDuringDrag(nextWidthPx);
      event.currentTarget.setAttribute("aria-valuenow", String(Math.round(nextWidthPx)));
    },
    [applyWorkspaceSidebarWidthDuringDrag],
  );

  const finishWorkspaceSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const resizeSession = workspaceSidebarResizeSessionRef.current;
      if (!resizeSession || resizeSession.pointerId !== event.pointerId) {
        return;
      }

      workspaceSidebarResizeSessionRef.current = null;
      setWorkspaceSidebarResizeActive({
        active: false,
        panelElement: workspaceSidebarPanelElementRef.current,
        shellElement: workspaceShellRef.current,
      });
      setWorkspaceSidebarPanelWidthPx((currentWidthPx) => {
        const finalWidthPx = workspaceSidebarPanelWidthPxRef.current;
        return currentWidthPx === finalWidthPx ? currentWidthPx : finalWidthPx;
      });
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!cancelled) {
        persistWorkspaceSidebarWidthPx(workspaceSidebarPanelWidthPxRef.current);
      }
    },
    [],
  );

  const handleWorkspaceSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isSidebarPanelVisible) {
        return;
      }

      const containerWidthPx = workspaceShellRef.current?.getBoundingClientRect().width;
      const maxWidthPx =
        containerWidthPx && containerWidthPx > 0
          ? containerWidthPx * WORKSPACE_SIDEBAR_MAX_WIDTH_RATIO
          : workspaceSidebarPanelWidthPxRef.current;
      let nextWidthPx: number | null = null;

      if (event.key === "ArrowLeft") {
        nextWidthPx =
          workspaceSidebarPanelWidthPxRef.current - WORKSPACE_SIDEBAR_RESIZE_KEYBOARD_STEP_PX;
      } else if (event.key === "ArrowRight") {
        nextWidthPx =
          workspaceSidebarPanelWidthPxRef.current + WORKSPACE_SIDEBAR_RESIZE_KEYBOARD_STEP_PX;
      } else if (event.key === "Home") {
        nextWidthPx = WORKSPACE_SIDEBAR_MIN_WIDTH_PX;
      } else if (event.key === "End") {
        nextWidthPx = maxWidthPx;
      }

      if (nextWidthPx === null) {
        return;
      }

      event.preventDefault();
      applyWorkspaceSidebarWidth(nextWidthPx, { persist: true });
    },
    [applyWorkspaceSidebarWidth, isSidebarPanelVisible],
  );

  useEffect(() => {
    return () => {
      setWorkspaceSidebarResizeActive({
        active: false,
        panelElement: workspaceSidebarPanelElementRef.current,
        shellElement: workspaceShellRef.current,
      });
    };
  }, []);

  const activeSearchResultHighlightRequest = useMemo(() => {
    if (!searchResultHighlightRequest) {
      return null;
    }

    const activeWorkspaceKey = buildTaskWorkspaceKey(workspaceAbsPath, workspaceIdentity);
    const requestWorkspaceKey = buildTaskWorkspaceKey(
      searchResultHighlightRequest.workspacePath,
      searchResultHighlightRequest.workspaceIdentity,
    );
    if (
      activeWorkspaceKey !== requestWorkspaceKey ||
      searchResultHighlightRequest.workspacePath !== workspaceAbsPath
    )
      return null;
    // 修复原因：ACP 历史选择先切回 draft pane，再异步恢复 Host 会话；旧的原生 taskId 守卫会吞掉高亮请求。
    if (searchResultHighlightRequest.kind === "acp")
      return activeTaskId === null &&
        (acpOpenRequest?.session.id === searchResultHighlightRequest.acpSessionId ||
          visibleAcpSession?.id === searchResultHighlightRequest.acpSessionId)
        ? searchResultHighlightRequest
        : null;
    return searchResultHighlightRequest.taskId === activeTaskId
      ? searchResultHighlightRequest
      : null;
  }, [
    acpOpenRequest,
    activeTaskId,
    searchResultHighlightRequest,
    visibleAcpSession?.id,
    workspaceAbsPath,
    workspaceIdentity,
  ]);
  const renderChatFindDialog = () => <TaskFindDialog {...taskFindDialogProps} placement="chat" />;
  const gitDirtyFileCount = useMemo(() => {
    // 关键业务逻辑：同一个文件可能同时出现在 staged / unstaged。
    // 这里按 path 去重后再统计，避免入口里“未提交更改文件数”被重复计算。
    return getGitDirtyFileCount(gitState.datasets);
  }, [gitState.datasets.staged, gitState.datasets.unstaged]);
  const workspaceRemoteTarget = useMemo(
    () =>
      workspaceTabs.find(
        (tab) =>
          tab.workspacePath === workspaceAbsPath &&
          (!workspaceIdentity || tab.workspaceIdentity === workspaceIdentity),
      )?.remoteTarget,
    [workspaceAbsPath, workspaceIdentity, workspaceTabs],
  );
  const workspaceLocalPathForRemoteMcpSync = useMemo(
    () =>
      workspaceTabs.find(
        (tab) =>
          tab.workspacePath === workspaceAbsPath &&
          (!workspaceIdentity || tab.workspaceIdentity === workspaceIdentity),
      )?.localWorkspacePath,
    [workspaceAbsPath, workspaceIdentity, workspaceTabs],
  );
  const workspaceShellSplitStyle = useMemo(
    () =>
      ({
        "--workspace-sidebar-panel-width": `${
          isSidebarPanelVisible ? workspaceSidebarPanelWidthPx : collapsedSidebarWidthPx
        }px`,
        "--workspace-sidebar-width": `${workspaceSidebarPanelWidthPx}px`,
        "--workspace-panel-radius": `${workspacePanelRadiusPx}px`,
        "--workspace-resize-handle-inset": `${workspaceResizeHandleInsetPx}px`,
      }) as CSSProperties,
    [
      collapsedSidebarWidthPx,
      isSidebarPanelVisible,
      workspacePanelRadiusPx,
      workspaceResizeHandleInsetPx,
      workspaceSidebarPanelWidthPx,
    ],
  );
  const activePreviewPath = useMemo(() => {
    const activeSidePaneTab =
      sidePaneState?.tabs.find((tab) => tab.id === sidePaneState.activeTabId) ?? null;
    return activeSidePaneTab?.type === "code-viewer"
      ? (activeSidePaneTab.source.path ?? null)
      : null;
  }, [sidePaneState]);
  const findFileLinkOwnerWorkspace = useCallback(
    (
      targetPath: string,
      targetWorkspaceIdentity?: string,
      targetWorkspaceRemoteSessionId?: string,
    ) => {
      const matches = workspaceTabs.filter(
        (tab) =>
          isWorkspaceFilePathInside(tab.workspacePath, targetPath) &&
          (!targetWorkspaceIdentity || tab.workspaceIdentity === targetWorkspaceIdentity) &&
          (!targetWorkspaceRemoteSessionId ||
            tab.remoteSessionId === targetWorkspaceRemoteSessionId),
      );
      if (matches.length === 0) {
        return null;
      }
      return (
        matches.sort((left, right) => {
          const leftActive = left.workspaceIdentity === workspaceIdentity ? 1 : 0;
          const rightActive = right.workspaceIdentity === workspaceIdentity ? 1 : 0;
          if (leftActive !== rightActive) {
            return rightActive - leftActive;
          }
          return right.workspacePath.length - left.workspacePath.length;
        })[0] ?? null
      );
    },
    [workspaceIdentity, workspaceTabs],
  );
  const openFileTreeRequest = useCallback((request: Omit<SidebarFileTreeOpenRequest, "id">) => {
    fileTreeOpenRequestIdRef.current += 1;
    setFileTreeOpenRequest({
      id: fileTreeOpenRequestIdRef.current,
      ...request,
    });
  }, []);
  const showChatMainView = useCallback(() => {
    onWorkspaceMainViewChange("chat");
  }, [onWorkspaceMainViewChange]);
  const primaryNavigationBack =
    workspaceMainView === "plugin-store" ? handleManageInstalledPlugins : handleTaskNavBack;
  const canPrimaryNavigationBack = workspaceMainView === "plugin-store" || canTaskNavBack;
  const handleCreateTaskInChat = useCallback(
    (request?: Parameters<typeof onCreateTask>[0]) => {
      // workspaceReadOnlyReason 判定的是活动 workspace；当 request 显式带 targetWorkspace 时
      // 目标另属他项目（跨项目发起已保存工作流），
      // 活动 workspace 的只读性不适用，真正的守卫是 root 动作对 target 的 isWorkspaceReadOnly。
      const hasTargetWorkspace =
        typeof request === "object" && request !== null && Boolean(request.targetWorkspace);
      if (!hasTargetWorkspace && workspaceReadOnlyReason) {
        return;
      }
      setAcpOpenRequest(null);
      showChatMainView();
      onCreateTask(request);
    },
    [onCreateTask, showChatMainView, workspaceReadOnlyReason],
  );
  const handleCreateConversationTaskInChat = useCallback(() => {
    if (!onCreateConversationTask) {
      handleCreateTaskInChat();
      return;
    }
    // 独立任务创建只更新工作区和草稿，已有工作区不会重挂载 App；
    // 与普通新建入口一样显式退出待办等主视图，并清除旧 ACP 打开请求。
    setAcpOpenRequest(null);
    showChatMainView();
    onCreateConversationTask();
  }, [handleCreateTaskInChat, onCreateConversationTask, showChatMainView]);
  const shellWorkbenchBinding = useMemo<WorkbenchSessionBinding | null>(
    () =>
      buildPrimaryWorkbenchSessionBinding(
        {
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity?.trim() ? { workspaceIdentity } : {}),
          ...(workspaceRemoteSessionId ? { remoteSessionId: workspaceRemoteSessionId } : {}),
        },
        activeTaskId,
        visibleAcpSession,
      ),
    [
      activeTaskId,
      visibleAcpSession,
      workspaceAbsPath,
      workspaceIdentity,
      workspaceRemoteSessionId,
    ],
  );
  const handleCreateAutomationInChat = useCallback(
    (prompt: string, targetWorkspace?: { workspacePath: string; workspaceIdentity?: string }) => {
      // 带 target 时跳过活动 workspace 只读检查，交由 handleCreateTaskInChat / root 动作在
      // target 上校验；无 target 时形状不变。
      if (!targetWorkspace && workspaceReadOnlyReason) return;
      handleCreateTaskInChat({
        initialPrompt: prompt,
        ...(targetWorkspace ? { targetWorkspace } : {}),
      });
    },
    [handleCreateTaskInChat, workspaceReadOnlyReason],
  );
  // 工作流「运行」现由中枢直接启动：GUI 建空会话 +
  // 发 startSavedWorkflow 命令，不再合成对话文案。本层只在 accepted 后把会话切到前台。
  const handleSelectTaskInChat = useCallback(
    (
      targetWorkspacePath: string,
      taskId: string,
      targetWorkspaceIdentity?: string,
      targetRemoteSessionId?: string,
      expectedUnreadAt?: number,
    ) => {
      setAcpOpenRequest(null);
      {
        const workspaceResult = ensureTaskNavigationWorkspace({
          workspacePath: targetWorkspacePath,
          workspaceIdentity: targetWorkspaceIdentity,
          activateTabByPath: tabStoreApi.getState().activateTabByPath,
          addLocalWorkspaceTab: (workspacePath) => {
            tabStoreApi.getState().addTab(workspacePath);
          },
        });
        if (!workspaceResult.accepted) {
          logger.warn("[automations] 运行历史目标远程 workspace 未连接，保留当前页面", {
            sessionId: taskId,
            workspaceIdentity: targetWorkspaceIdentity,
            workspacePath: targetWorkspacePath,
          });
          toast(intl.formatMessage({ id: "automations.runs.openSessionFailed" }));
          return;
        }
        if (workspaceResult.openedLocalTab) {
          logger.info("[automations] 为运行历史会话补开本地 workspace tab", {
            sessionId: taskId,
            workspacePath: targetWorkspacePath,
          });
        }
        const resolvedRemoteSessionId =
          targetRemoteSessionId ??
          workspaceTabs.find(
            (tab) =>
              (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
              (targetWorkspaceIdentity?.trim() || targetWorkspacePath),
          )?.remoteSessionId;
        const target: V4SplitPaneSessionTarget = {
          workspacePath: targetWorkspacePath,
          ...(targetWorkspaceIdentity?.trim()
            ? { workspaceIdentity: targetWorkspaceIdentity }
            : {}),
          ...(resolvedRemoteSessionId ? { remoteSessionId: resolvedRemoteSessionId } : {}),
          sessionId: taskId,
        };
        selectWorkbenchSession(shellWorkbenchBinding, target);
      }
      // 只有目标 workspace 已经激活或补开成功后才关闭 Automations，避免失败时看起来像跳转成功。
      showChatMainView();
      if (typeof expectedUnreadAt === "number") {
        handleSelectTask(targetWorkspacePath, taskId, targetWorkspaceIdentity, expectedUnreadAt);
      } else {
        handleSelectTask(targetWorkspacePath, taskId, targetWorkspaceIdentity);
      }
    },
    [handleSelectTask, intl, shellWorkbenchBinding, showChatMainView, tabStoreApi, workspaceTabs],
  );
  // 中枢直接启动 accepted 后切到新会话（run 卡已在顶部）：复用运行历史那条导航，
  // target 恒带工作流所属项目坐标（不变式 7），remoteSessionId 决定连接 endpoint。
  const handleNavigateToLaunchedRun = useCallback(
    (target: SavedWorkflowLaunchTarget, sessionId: string) => {
      handleSelectTaskInChat(
        target.workspacePath,
        sessionId,
        target.workspaceIdentity,
        target.remoteSessionId,
      );
    },
    [handleSelectTaskInChat],
  );
  // 工作流运行历史「查看实例」：先回到发起它的会话（侧栏页只在 chat 视图里可见），再开实例详情页。
  const handleOpenSavedWorkflowRun = useCallback(
    (params: SavedWorkflowsOpenRunParams) => {
      // 中枢是跨项目视图：实例必须开在发起它的项目，而非活动项目。
      // params 恒带 workspacePath/identity；仅在异常缺省时兜底回退到活动 workspace。
      const targetWorkspacePath = params.workspacePath || workspaceAbsPath;
      const targetWorkspaceIdentity =
        params.workspaceIdentity ?? (workspaceIdentity?.trim() ? workspaceIdentity : undefined);
      // remoteSessionId 不在契约里：按目标 workspace 从已打开 tab 反查；命中活动项目即取活动值。
      const targetRemoteSessionId = workspaceTabs.find(
        (tab) =>
          tab.workspacePath === targetWorkspacePath &&
          (!targetWorkspaceIdentity || tab.workspaceIdentity === targetWorkspaceIdentity),
      )?.remoteSessionId;
      handleSelectTaskInChat(
        targetWorkspacePath,
        params.sessionId,
        targetWorkspaceIdentity,
        targetRemoteSessionId,
      );
      handleOpenWorkflowRun({
        workspacePath: targetWorkspacePath,
        ...(targetWorkspaceIdentity ? { workspaceIdentity: targetWorkspaceIdentity } : {}),
        ...(targetRemoteSessionId ? { remoteSessionId: targetRemoteSessionId } : {}),
        parentSessionId: params.sessionId,
        toolCallId: params.toolCallId,
        runId: params.runId,
        workflowName: params.workflowName,
      });
    },
    [
      handleOpenWorkflowRun,
      handleSelectTaskInChat,
      workspaceAbsPath,
      workspaceIdentity,
      workspaceTabs,
    ],
  );
  // 侧栏运行行：与 composer 徽标
  // 同一跳转——先选中会话，再开 run pane。没有 toolCallId 的 run（不该有）只选中会话。
  const handleOpenSidebarWorkflowRun = useCallback(
    (target: WorkflowRunOpenTarget) => {
      if (target.run.toolCallId === undefined) {
        const targetRemoteSessionId = workspaceTabs.find(
          (tab) =>
            tab.workspacePath === target.workspacePath &&
            (!target.workspaceIdentity || tab.workspaceIdentity === target.workspaceIdentity),
        )?.remoteSessionId;
        handleSelectTaskInChat(
          target.workspacePath,
          target.sessionId,
          target.workspaceIdentity,
          targetRemoteSessionId,
        );
        return;
      }
      handleOpenSavedWorkflowRun({
        sessionId: target.sessionId,
        runId: target.run.runId,
        toolCallId: target.run.toolCallId,
        workflowName: target.run.name ?? "",
        workspacePath: target.workspacePath,
        ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      });
    },
    [handleOpenSavedWorkflowRun, handleSelectTaskInChat, workspaceTabs],
  );
  // 中枢的产物 chip：与「查看实例」逐字同构（同一条「先回到发起它的会话」的路径），
  // 只是终点是 `workflow-artifact` tab 而不是 run 详情页。
  const handleOpenSavedWorkflowArtifact = useCallback(
    (params: SavedWorkflowsOpenArtifactParams) => {
      const targetWorkspacePath = params.workspacePath || workspaceAbsPath;
      const targetWorkspaceIdentity =
        params.workspaceIdentity ?? (workspaceIdentity?.trim() ? workspaceIdentity : undefined);
      const targetRemoteSessionId = workspaceTabs.find(
        (tab) =>
          tab.workspacePath === targetWorkspacePath &&
          (!targetWorkspaceIdentity || tab.workspaceIdentity === targetWorkspaceIdentity),
      )?.remoteSessionId;
      handleSelectTaskInChat(
        targetWorkspacePath,
        params.sessionId,
        targetWorkspaceIdentity,
        targetRemoteSessionId,
      );
      handleOpenWorkflowArtifact({
        workspacePath: targetWorkspacePath,
        ...(targetWorkspaceIdentity ? { workspaceIdentity: targetWorkspaceIdentity } : {}),
        ...(targetRemoteSessionId ? { remoteSessionId: targetRemoteSessionId } : {}),
        parentSessionId: params.sessionId,
        runId: params.runId,
        artifactId: params.artifactId,
        ...(params.title === undefined ? {} : { title: params.title }),
        // 中枢的 chip 载荷带得到 contentType（html 产物据它直接开浏览器 tab）；`sourcePath`
        // 那份载荷没有，由 `handleOpenWorkflowArtifact` 自己查 journal 补。
        ...(params.contentType === undefined ? {} : { contentType: params.contentType }),
      });
    },
    [
      handleOpenWorkflowArtifact,
      handleSelectTaskInChat,
      workspaceAbsPath,
      workspaceIdentity,
      workspaceTabs,
    ],
  );
  const handlePaneActiveSessionChange = useCallback(
    (
      scope: {
        workspacePath: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
      },
      sessionId: string,
    ) => {
      handleSelectTaskInChat(
        scope.workspacePath,
        sessionId,
        scope.workspaceIdentity,
        scope.remoteSessionId,
      );
    },
    [handleSelectTaskInChat],
  );

  const canOpenSessionInSplitPane = useCallback(
    (target: V4SplitPaneSessionTarget) => {
      return canPlaceWorkbenchSessionInSplit(shellWorkbenchBinding, target, {
        mode: "context-menu",
        side: "right",
      });
    },
    [shellWorkbenchBinding],
  );
  const handleOpenSessionInSplitPane = useCallback(
    (target: V4SplitPaneSessionTarget) => {
      showChatMainView();
      const shouldSelectTarget = placeWorkbenchSessionInSplit(shellWorkbenchBinding, target, {
        mode: "context-menu",
        side: "right",
      });
      if (shouldSelectTarget && target.kind !== "acp") {
        handleSelectTask(target.workspacePath, target.sessionId, target.workspaceIdentity);
      }
    },
    [handleSelectTask, shellWorkbenchBinding, showChatMainView],
  );
  const handleStartDraftInWorkspaceInChat = useCallback(
    (
      targetWorkspacePath: string,
      targetWorkspaceIdentity?: string,
      targetWorkspacePurpose?: import("@zcode/shared").WorkspacePurpose,
      createSource?: import("@zcode/shared").SessionCreateSource,
    ) => {
      setAcpOpenRequest(null);
      showChatMainView();
      handleStartDraftInWorkspace(
        targetWorkspacePath,
        targetWorkspaceIdentity,
        targetWorkspacePurpose,
        createSource,
      );
    },
    [handleStartDraftInWorkspace, showChatMainView],
  );
  const {
    selected: worktreeSelected,
    sourceBranchName: worktreeSourceBranchName,
    creating: worktreeCreating,
    select: selectWorktreeDraft,
    createWorktree: createWorktreeForDraft,
  } = useWorktreeDraftSelection({
    workspacePath: workspaceAbsPath,
    workspaceIdentity,
    draftFocusVersion: workspaceShellZCodeState.draftFocusVersion,
    sessionId: activeTaskId,
  });
  const [worktreeAutoSend, setWorktreeAutoSend] = useState<WorktreeAutoSendRequest | null>(null);
  const worktreeRequestIdRef = useRef(0);
  const openCreatedWorktree = useCallback(
    (
      path: string,
      draft: V4ComposerDraft,
      agent: AcpAgent | null,
      trigger: WorktreeAutoSendRequest["trigger"],
    ) => {
      // Git add 已完成；即使后续草稿落盘失败，也不能让下一次点击再创建一棵工作树。
      selectWorktreeDraft(false);
      if (!persistV4ComposerDraft(path, undefined, V4_DRAFT_SCOPE_ROOT, draft)) {
        throw new Error("worktree-draft-save-failed");
      }
      try {
        handleStartDraftInWorkspaceInChat(path, undefined, "project");
        if (
          tabStoreApi.getState().activeWorkspacePath !== path ||
          tabStoreApi.getState().activeWorkspaceIdentity
        ) {
          throw new Error("worktree-workspace-open-failed");
        }
        const draftFocusVersion = useZCodeSessionStore
          .getState()
          .getWorkspaceState(path).draftFocusVersion;
        setWorktreeAutoSend({
          requestId: ++worktreeRequestIdRef.current,
          workspacePath: path,
          draftFocusVersion,
          text: draft.text.trim(),
          agent,
          trigger,
        });
      } catch (error) {
        setWorktreeAutoSend(null);
        throw error;
      }
    },
    [handleStartDraftInWorkspaceInChat, tabStoreApi, selectWorktreeDraft],
  );
  const consumeWorktreeAutoSend = useCallback((requestId: number) => {
    setWorktreeAutoSend((current) => (current?.requestId === requestId ? null : current));
  }, []);
  const observedWorktreeAutoSendRef = useRef<number | null>(null);
  useEffect(() => {
    if (!worktreeAutoSend) {
      observedWorktreeAutoSendRef.current = null;
      return;
    }
    const atTarget =
      worktreeAutoSend.workspacePath === workspaceAbsPath &&
      worktreeAutoSend.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion &&
      activeTaskId === null;
    if (atTarget) {
      observedWorktreeAutoSendRef.current = worktreeAutoSend.requestId;
    } else if (observedWorktreeAutoSendRef.current === worktreeAutoSend.requestId) {
      // 目标草稿曾就绪但用户已离开；回到旧 tab 时不得兑现迟到的自动提交。
      consumeWorktreeAutoSend(worktreeAutoSend.requestId);
    }
  }, [
    activeTaskId,
    consumeWorktreeAutoSend,
    workspaceAbsPath,
    workspaceShellZCodeState.draftFocusVersion,
    worktreeAutoSend,
  ]);
  const activeWorktreeAutoSend =
    worktreeAutoSend?.workspacePath === workspaceAbsPath &&
    worktreeAutoSend.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion &&
    activeTaskId === null
      ? worktreeAutoSend
      : null;
  const worktreeDraftIntent = useMemo(
    () => ({
      selected: worktreeSelected,
      select: selectWorktreeDraft,
      createWorktree: createWorktreeForDraft,
      autoSend: activeWorktreeAutoSend,
      openCreatedWorktree,
      consumeAutoSend: consumeWorktreeAutoSend,
    }),
    [
      worktreeSelected,
      selectWorktreeDraft,
      createWorktreeForDraft,
      activeWorktreeAutoSend,
      openCreatedWorktree,
      consumeWorktreeAutoSend,
    ],
  );
  const handleCreateProjectDraft = useCallback(
    (path: string, identity?: string) =>
      handleStartDraftInWorkspaceInChat(path, identity, undefined, "project"),
    [handleStartDraftInWorkspaceInChat],
  );
  const handleSelectAcpSession = useCallback(
    (session: AcpSidebarSession) => {
      const targetKey = session.workspaceIdentity?.trim() || session.workspacePath;
      const workspaceResult = ensureTaskNavigationWorkspace({
        workspacePath: session.workspacePath,
        workspaceIdentity: session.workspaceIdentity,
        activateTabByPath: tabStoreApi.getState().activateTabByPath,
        addLocalWorkspaceTab: (path) => tabStoreApi.getState().addTab(path),
      });
      if (!workspaceResult.accepted) return;
      // 已由分屏 owner 持有的 ACP 只聚焦/替换窗格；起主草稿会退出 group 并清掉另一会话。
      if (
        selectWorkbenchSession(
          shellWorkbenchBinding,
          {
            workspacePath: session.workspacePath,
            ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
            ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
            sessionId: session.id,
            kind: "acp",
            agent: session.agent,
          },
          () => {
            // 临时布局的 native 选择只是 secondary 的导航投影；替换为 ACP 后必须清理，
            // 否则旧 API id 不再匹配窗格，会重新出现在空主草稿中。复用原 owner，保留布局。
            const store = useZCodeSessionStore.getState();
            store.setActiveTaskId(workspaceAbsPath, null, workspaceIdentity);
            if (targetKey !== workspaceKey) {
              store.setActiveTaskId(session.workspacePath, null, session.workspaceIdentity);
            }
          },
        )
      ) {
        setAcpOpenRequest(null);
        showChatMainView();
        return;
      }
      // 修复原因：ACP 点击只把主 pane 切回 draft 容器，然后指定 Host id；
      // 绝不把该 id 送进 handleSelectTask 的 CLI task 路由。
      if (
        activeTaskId !== null ||
        targetKey !== workspaceKey ||
        session.workspacePath !== workspaceAbsPath
      ) {
        handleStartDraftInWorkspaceInChat(session.workspacePath, session.workspaceIdentity);
      } else {
        showChatMainView();
      }
      setAcpOpenRequest({
        requestId: ++acpOpenRequestIdRef.current,
        session,
        // 显式新建可从快捷键进入；旧 ACP 请求不能被保存成这次新草稿的导航目标。
        draftFocusVersion: useZCodeSessionStore
          .getState()
          .getWorkspaceState(session.workspacePath, session.workspaceIdentity).draftFocusVersion,
      });
    },
    [
      activeTaskId,
      handleStartDraftInWorkspaceInChat,
      shellWorkbenchBinding,
      showChatMainView,
      tabStoreApi,
      workspaceAbsPath,
      workspaceKey,
    ],
  );
  const handleOpenWorkTaskConversation = useCallback(
    (task: import("@zcode/shared").WorkTask) => {
      if (!task.session || !task.worktree || task.workspaceIdentity || task.remoteSessionId) return;
      // 工作树会话必须先补齐主项目 tab，再复用现有选择入口，才能归在原项目下。
      tabStoreApi
        .getState()
        .ensureWorkspaceTab(task.workspacePath, { workspacePurpose: "project" });
      if (task.session.kind === "acp" && task.execution.kind === "acp") {
        handleSelectAcpSession({
          id: task.session.id,
          agent: task.execution.agent,
          title: task.title,
          status:
            task.status === "running" || task.status === "awaiting_input" ? "running" : "idle",
          workspacePath: task.worktree.path,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        });
      } else {
        handleSelectTaskInChat(task.worktree.path, task.session.id);
      }
    },
    [handleSelectAcpSession, handleSelectTaskInChat, tabStoreApi],
  );
  useDesktopWindowNavigation({
    workspacePath: workspaceAbsPath,
    workspaceIdentity,
    activeSessionId: activeTaskId,
    acpSession:
      visibleAcpSession ??
      (acpOpenRequest &&
      acpOpenRequest.draftFocusVersion === workspaceShellZCodeState.draftFocusVersion &&
      (acpOpenRequest.session.workspaceIdentity?.trim() || acpOpenRequest.session.workspacePath) ===
        workspaceKey
        ? acpOpenRequest.session
        : null),
    chatVisible: workspaceMainView === "chat",
    draftFocusVersion: workspaceShellZCodeState.draftFocusVersion,
    selectApi: handleSelectTaskInChat,
    selectAcp: handleSelectAcpSession,
  });
  useWorktreeSettingsConversation({
    selectAcp: handleSelectAcpSession,
    selectApi: handleSelectTaskInChat,
    openWorkTasks: handleOpenWorkTasks,
  });
  const activeWorkspacePurpose =
    workspaceTabs.find(
      (tab) =>
        tab.workspacePath === workspaceAbsPath &&
        (!workspaceIdentity || tab.workspaceIdentity === workspaceIdentity),
    )?.workspacePurpose ?? "project";
  const handleSelectConversationWorkspace = useCallback(async () => {
    if (!onResolveConversationWorkspace) {
      return;
    }
    let targetWorkspacePath: string;
    try {
      targetWorkspacePath = await onResolveConversationWorkspace();
    } catch (error) {
      logger.error("[WorkspaceShellLayout] 切换对话 workspace 失败", {
        error,
      });
      return;
    }
    if ((workspaceIdentity?.trim() || workspaceAbsPath) !== targetWorkspacePath) {
      requestV4ComposerDraftWorkspaceTransfer({
        sourceWorkspacePath: workspaceAbsPath,
        sourceWorkspaceIdentity: workspaceIdentity,
        targetWorkspacePath,
      });
    }
    handleStartDraftInWorkspaceInChat(targetWorkspacePath, undefined, "conversation");
  }, [
    handleStartDraftInWorkspaceInChat,
    onResolveConversationWorkspace,
    workspaceAbsPath,
    workspaceIdentity,
  ]);
  const handleSelectComposerPlugin = useCallback(
    (mention: ComposerMentionPrefill) => {
      useZCodeSessionStore
        .getState()
        .requestComposerTextInsert(
          workspaceAbsPath,
          mention.markdown,
          workspaceIdentity,
          mention,
          "prepend-if-missing",
        );
    },
    [workspaceAbsPath, workspaceIdentity],
  );
  // v4 pane 生命周期回调（稳定引用，供 memo 友好的 pane 宿主消费）：
  // createSession/fork 后接入既有选择路径；删除会话后回 draft。
  const handleV4SessionCreated = useCallback(
    (sessionId: string) => {
      handleSelectTask(workspaceAbsPath, sessionId, workspaceIdentity);
    },
    [handleSelectTask, workspaceAbsPath, workspaceIdentity],
  );
  // 草稿态 composer contextHeader：workspace 切换菜单 +
  // Git 分支切换器，与旧 ChatView 空态 contextHeaderContent 同构。壳级能力
  // （workspaceTabs / 远程连接回调）在此闭合，pane 只收 ReactNode。
  // onSelectWorkspace 语义与旧版一致：切到目标 workspace 的新草稿。
  const draftComposerHeader = useMemo(
    () => (
      <>
        <ChatEmptyWorkspacePreviewMenu
          workspacePath={workspaceAbsPath}
          workspaceIdentity={workspaceIdentity}
          isWindowsDesktop={isWindowsDesktop}
          workspaceTabs={workspaceTabs}
          onSelectWorkspace={(workspaceTab) =>
            handleStartDraftInWorkspaceInChat(
              workspaceTab.workspacePath,
              workspaceTab.workspaceIdentity,
              workspaceTab.workspacePurpose,
            )
          }
          onSelectConversationWorkspace={handleSelectConversationWorkspace}
          onOpenFolder={onOpenFolderFromWorkspaceMenu}
          allowOpenWorkspace={allowOpenWorkspace}
          allowRemoteWorkspace={allowRemoteWorkspace}
          remoteWorkspaceSessions={remoteWorkspaceSessions}
          onConnectRemote={onConnectRemote}
          onSelectRemoteProject={onSelectRemoteProject}
          onCancelRemoteProject={onCancelRemoteProject}
        />
        {isOfficeMode ? (
          <WorkspacePluginPreview
            onOpen={handleOpenPluginStore}
            onSelectPlugin={handleSelectComposerPlugin}
            workspacePath={workspaceAbsPath}
            workspaceIdentity={workspaceIdentity}
            remoteSessionId={workspaceRemoteSessionId ?? undefined}
          />
        ) : !isOfficeMode && activeWorkspacePurpose === "project" ? (
          <GitBranchSwitcher
            workspacePath={workspaceAbsPath}
            gitSummary={gitState.summary}
            dirtyFileCount={gitDirtyFileCount}
            onRefreshGit={handleRefreshGit}
            allowWorktreeCreation={!workspaceIdentity}
            worktreeSelected={worktreeSelected}
            worktreeSourceBranchName={worktreeSourceBranchName}
            worktreeCreating={worktreeCreating}
            onWorktreeSelectedChange={selectWorktreeDraft}
            className="px-0 pt-0"
            popoverClassName="w-72"
            branchListClassName="max-h-48"
            // 输入框区域在底部，Radix 碰撞避让会把分支菜单翻到下方。
            // 这里锁定上方弹出，避免菜单遮挡输入区并保持操作方向稳定。
            avoidPopoverCollisions={false}
          />
        ) : null}
      </>
    ),
    [
      isOfficeMode,
      workspaceRemoteSessionId,
      handleOpenPluginStore,
      handleSelectComposerPlugin,
      allowOpenWorkspace,
      allowRemoteWorkspace,
      activeWorkspacePurpose,
      gitDirtyFileCount,
      gitState.summary,
      handleRefreshGit,
      worktreeSelected,
      selectWorktreeDraft,
      handleSelectConversationWorkspace,
      worktreeSourceBranchName,
      worktreeCreating,
      handleStartDraftInWorkspaceInChat,
      isWindowsDesktop,
      onCancelRemoteProject,
      onConnectRemote,
      onOpenFolderFromWorkspaceMenu,
      onSelectRemoteProject,
      remoteWorkspaceSessions,
      workspaceAbsPath,
      workspaceIdentity,
      workspaceTabs,
    ],
  );
  const handleV4SessionDeleted = useCallback(() => {
    if (activeTaskId) {
      for (const tab of sidePaneState?.tabs ?? []) {
        if (tab.type === "selection-side-chat" && tab.parentSessionId === activeTaskId) {
          handleCloseSidePaneTab(tab.id);
        }
      }
    }
    handleStartDraftInWorkspaceInChat(workspaceAbsPath, workspaceIdentity);
  }, [
    activeTaskId,
    handleCloseSidePaneTab,
    handleStartDraftInWorkspaceInChat,
    sidePaneState?.tabs,
    workspaceAbsPath,
    workspaceIdentity,
  ]);
  const handleOpenMarkdownFileLink = useCallback(
    async (target: WorkspacePathOpenRequest) => {
      if (panelReadOnlyReason && target.serviceScope !== "base-local") {
        return;
      }
      try {
        const fileService = selectWorkspacePathFileService(
          target,
          panelServices.fileService,
          baseServices.fileService,
        );
        const fileStat = await fileService.stat({
          path: target.path,
        });
        if (fileStat.type === "file") {
          if (
            shouldOpenAssistantHtmlInBrowser({
              path: target.path,
              workspaceIdentity: target.workspaceIdentity,
              workspaceRemoteSessionId: target.workspaceRemoteSessionId,
            })
          ) {
            handleOpenBrowserUrl(toFileUrl(target.path));
            return;
          }
          handleOpenCodeViewer({
            type: "file",
            title: getPathLeaf(target.path),
            path: target.path,
            workspacePath: target.workspacePath,
            workspaceIdentity: target.workspaceIdentity,
            workspaceRemoteSessionId: target.workspaceRemoteSessionId,
          });
          return;
        }

        if (target.serviceScope === "base-local") {
          openFileTreeRequest({
            target: {
              workspacePath: target.path,
              workspaceName: target.label || getPathLeaf(target.path),
              revealPath: target.path,
              temporaryExternalDirectory: true,
            },
          });
          return;
        }

        const ownerWorkspace = findFileLinkOwnerWorkspace(
          target.path,
          target.workspaceIdentity,
          target.workspaceRemoteSessionId,
        );
        if (ownerWorkspace) {
          openFileTreeRequest({
            target: {
              workspacePath: ownerWorkspace.workspacePath,
              workspaceName: ownerWorkspace.label,
              workspaceIdentity: ownerWorkspace.workspaceIdentity,
              workspaceRemoteSessionId: ownerWorkspace.remoteSessionId,
              revealPath: areWorkspaceFilePathsEqual(ownerWorkspace.workspacePath, target.path)
                ? undefined
                : target.path,
            },
          });
          return;
        }

        openFileTreeRequest({
          target: {
            workspacePath: target.path,
            workspaceName: target.label || getPathLeaf(target.path),
            revealPath: target.path,
            temporaryExternalDirectory: true,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[WorkspaceShell] 打开 markdown 文件链接失败", {
          path: target.path,
          error: message,
        });
        if (shouldFallbackWorkspacePathToCodeViewer(target)) {
          // markdown file link 可能指向已不存在的路径。
          // stat 失败时仍交给 CodeViewer 展示具体读文件错误，避免点击完全无反馈。
          handleOpenCodeViewer({
            type: "file",
            title: getPathLeaf(target.path),
            path: target.path,
            workspacePath: target.workspacePath,
            workspaceIdentity: target.workspaceIdentity,
            workspaceRemoteSessionId: target.workspaceRemoteSessionId,
          });
        }
        toast(intl.formatMessage({ id: "workspaceFileTree.openFailed" }));
      }
    },
    [
      findFileLinkOwnerWorkspace,
      baseServices.fileService,
      handleOpenBrowserUrl,
      handleOpenCodeViewer,
      intl,
      openFileTreeRequest,
      panelServices.fileService,
      panelReadOnlyReason,
    ],
  );
  useEffect(
    () =>
      addWorkspacePathOpenRequestListener((target) => {
        void handleOpenMarkdownFileLink(target);
      }),
    [handleOpenMarkdownFileLink],
  );
  const handleRevealGitFileInTree = useCallback(
    (path: string) => {
      if (panelReadOnlyReason) {
        return;
      }
      openFileTreeRequest({
        target: {
          workspacePath: panelWorkspacePath,
          workspaceName: getPathLeaf(panelWorkspacePath),
          workspaceIdentity: panelWorkspaceIdentity,
          workspaceRemoteSessionId: panelRemoteSessionId,
          revealPath: path,
        },
      });
    },
    [
      openFileTreeRequest,
      panelWorkspacePath,
      panelWorkspaceIdentity,
      panelRemoteSessionId,
      panelReadOnlyReason,
    ],
  );
  const activeSelectionSideChatSessionId = activeTaskId
    ? (getActiveSelectionSideChatTab(sidePaneState, {
        workspaceKey,
        parentSessionId: activeTaskId,
      })?.childSessionId ?? null)
    : null;
  const handleOpenSelectionSideConversationLauncher = useCallback(() => {
    if (!panelActiveTaskId) return;
    const requested = requestSelectionSideChatOpen(
      buildSelectionSideChatKey(panelWorkspaceKey, panelActiveTaskId),
    );
    if (!requested) {
      // 固定入口由当前主 SessionPane 承接命令；若 pane 尚未挂载，不允许壳层自行拼接远程身份或协议。
      logger.warn("[WorkspaceShell] 辅助对话入口没有可用的主会话控制器", {
        parentSessionId: panelActiveTaskId,
        workspaceKey: panelWorkspaceKey,
      });
    }
  }, [panelActiveTaskId, panelWorkspaceKey]);
  const renderSidePanePanel = () => (
    <ServiceProvider services={panelServices}>
      <AnimatedSidePanePanel
        services={panelServices}
        isDesktop={isDesktop}
        isWindowsDesktop={isWindowsDesktop}
        frameClassName={resolveWorkspaceShellWindowChromeClass({
          isMacDesktop,
          isWindowsDesktop,
          isLinuxDesktop,
          macOSMajorVersion: desktopWindowChromeState?.macOSMajorVersion,
          isWindowsMaximized: desktopWindowChromeState?.isMaximized ?? false,
          supportsNativeRoundedCorners:
            desktopWindowChromeState?.supportsNativeRoundedCorners ?? null,
        })}
        showWindowControls={usesInlineWindowControls}
        isVisible={hasWorkspaceToolsView && isSidePaneVisible}
        onCloseSidePane={handleToggleSidePane}
        toggleSidePaneShortcutLabel={toggleSidePaneShortcutLabel}
        sidePaneState={sidePaneState}
        recentClosedSidePaneTabs={recentClosedSidePaneTabs}
        isBrowserOpen={isBrowserOpen}
        supportsEmbeddedBrowser={supportsEmbeddedBrowser}
        workspaceAbsPath={panelWorkspacePath}
        workspaceIdentity={panelWorkspaceIdentity}
        workspaceRemoteSessionId={panelRemoteSessionId}
        activeTaskId={panelActiveTaskId}
        sidePaneOwnerId={panelOwnerId}
        gitState={gitState}
        activeGitSourceId={activeGitSourceId}
        panelRef={sidePanePanelRef}
        panelElementRef={sidePanePanelElementRef}
        browserNavigationRequest={browserNavigationRequest}
        browserRestoreUrls={browserRestoreUrls}
        screenshotSurfaceRequest={screenshotSurfaceRequest}
        screenshotSurfaceTabId={screenshotSurfaceTab?.id ?? null}
        fileChangeFindActiveIndex={fileChangeFindActiveIndex}
        fileChangeFindNavigationRequestId={fileChangeFindNavigationRequestId}
        fileChangeFindQuery={fileChangeFindQuery}
        onFileChangeFindMatchCountChange={onFileChangeFindMatchCountChange}
        onCloseCodeViewer={handleCloseCodeViewer}
        onCloseGit={handleCloseGit}
        onActivateTab={handleActivateSidePaneTab}
        onReorderTab={handleReorderSidePaneTab}
        onCloseTab={handleCloseSidePaneTab}
        onCloseOtherTabs={handleCloseOtherSidePaneTabs}
        onCloseAllTabs={handleCloseAllSidePaneTabs}
        onReopenClosedTab={handleReopenClosedSidePaneTab}
        onOpenBrowserTab={handleOpenBrowserTab}
        onOpenWhiteboard={handleOpenWhiteboard}
        onOpenDeveloperTools={handleOpenDeveloperTools}
        onOpenTerminalTab={handleOpenTerminalTab}
        onOpenReviewTab={handleToggleGit}
        onWorkTaskReviewContainerChange={
          workTaskToolTarget ? setWorkTaskReviewContainer : undefined
        }
        onOpenSelectionSideConversation={handleOpenSelectionSideConversationLauncher}
        onRevealGitFileInTree={handleRevealGitFileInTree}
        onOpenBrowserUrl={handleOpenBrowserUrl}
        onOpenCodeViewer={handleOpenCodeViewer}
        onOpenFileLink={handleOpenMarkdownFileLink}
        onOpenBackgroundBash={handleOpenBackgroundBash}
        onOpenSubagentSession={handleOpenSubagentSession}
        onOpenWorkflowActorSession={handleOpenWorkflowActorSession}
        onOpenWorkflowWorkspace={handleOpenWorkflowWorkspace}
        onOpenWorkflowArtifact={handleOpenWorkflowArtifact}
        onOpenWorkflowRun={handleOpenWorkflowRun}
        onRefreshGit={handleRefreshGit}
        onBrowserNavigationRequestHandled={handleBrowserNavigationRequestHandled}
        onBrowserUrlChange={handleBrowserUrlChange}
        onBrowserPageMetadataChange={handleBrowserPageMetadataChange}
        onSelectGitSource={setGitSelectedSourceId}
      />
    </ServiceProvider>
  );
  const sidePanePanel = renderSidePanePanel();
  const hasUpdateStatusButton =
    updateReadyVersion !== null ||
    updateState?.kind === "update-available" ||
    updateState?.kind === "download-progress" ||
    updateState?.kind === "update-downloaded";
  // Draft 之前维护一套独立轻量 header，导致 side pane、caption 安全区和拖拽入口
  // 与 Task Header 分叉。桌面端统一复用 WorkspaceHeader，只由 variant 裁剪 task 专属内容；
  // 手机远控无 active task 时仍不渲染桌面 chrome，继续遵守 replayable overlay 边界。
  const shouldRenderMainViewHeader = workspaceMainView === "chat";
  // Web 非聊天页没有桌面拖拽标题栏，侧栏收起后需为 h-14 全局导航预留高度，避免遮住任务标题及操作。
  const shouldReserveWebNavigationSpace =
    !isDesktop && !isSidebarVisible && !shouldRenderMainViewHeader;
  const shouldRenderWorkspaceHeader =
    shouldRenderMainViewHeader && (activeTaskId !== null || acpHeaderTitle !== null || isDesktop);
  // ErrorBoundary resetKeys 的数组如果每次 render 都重新创建，
  // 即使 workspace/task 没变化也会在 React DevTools Components 轨道里持续表现为子树 props 变化。
  const workspaceOnlyResetKeys = useMemo(() => [workspaceKey], [workspaceKey]);
  const workspaceDraftResetKeys = useMemo(
    () => [workspaceKey, activeTaskId ?? "draft"],
    [workspaceKey, activeTaskId],
  );
  const workspaceSidebarVisibilityResetKeys = useMemo(
    () => [workspaceKey, isSidebarVisible],
    [workspaceKey, isSidebarVisible],
  );

  return (
    <DesktopWindowFrame
      title={`${PRODUCT_NAME} / ${getPathLeaf(workspaceAbsPath)}`}
      showHeader
      isDesktop={isDesktop}
      isMacDesktop={isMacDesktop}
      isWindowsDesktop={isWindowsDesktop}
      headerTestId={TID_APP_HEADER}
    >
      <CommandCenterDialog
        open={commandCenterOpen}
        commands={commandCenterCommands}
        workspaceAbsPath={workspaceAbsPath}
        workspaceIdentity={workspaceIdentity}
        activeTaskId={activeTaskId}
        activeAcpSessionId={visibleAcpSession?.id}
        activeTaskChangeSummary={activeTaskChangeSummary}
        workspaceTabs={commandCenterWorkspaceTabs}
        onOpenChange={onCommandCenterOpenChange}
        onSelectTask={handleSelectTaskInChat}
        onSelectAcpSession={handleSelectAcpSession}
        onSearchResultHighlightRequest={onCommandCenterSearchResultHighlightRequest}
        onOpenCodeViewer={onCommandCenterOpenCodeViewer}
      />
      <div
        ref={workspaceShellRef}
        data-workspace-shell="true"
        style={workspaceShellSplitStyle}
        className={cn(
          "@container/workspace-shell relative flex h-full min-h-0 w-full overflow-hidden",
          // 窗口原生 resize 时，外层 react-resizable-panels 会把每一帧
          // 都写进 layout store，连带侧栏 tooltip/menu 子树反复 commit。这里改成
          // CSS 变量驱动的专用 split，普通窗口 resize 只走浏览器布局，不触发 React 状态。
        )}
      >
        <div
          ref={workspaceSidebarPanelElementRef}
          data-panel=""
          data-workspace-sidebar-panel="true"
          id="sidebar"
          className={cn(
            "w-[var(--workspace-sidebar-panel-width)] max-w-[50%] flex-none overflow-hidden duration-200 ease-out transition-[width,opacity] data-[workspace-sidebar-resizing=true]:transition-opacity",
            // 拖动侧栏宽度时如果继续过渡 width，会让指针移动和实际宽度之间产生滞后。
            // 拖拽 active 通过 DOM 标记切 transition，避免 pointerdown/up 为了切 class 重渲染整棵 workspace。
            isSidebarPanelVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <aside
            ref={sidebarContainerRef}
            className="h-full overflow-hidden select-none"
            aria-hidden={!isSidebarPanelVisible}
          >
            <ScopedErrorBoundary
              scope="workspace-sidebar"
              resetKeys={workspaceOnlyResetKeys}
              variant="panel"
              className="h-full"
            >
              {/* session workbench groups：桌面和普通 web app 可分屏。 */}
              <V4SplitPaneEntryProvider
                enabled
                canOpenSession={canOpenSessionInSplitPane}
                onOpenSession={handleOpenSessionInSplitPane}
              >
                <WorkflowRunOpenProvider onOpenRun={handleOpenSidebarWorkflowRun}>
                  <WorkspaceSidebar
                    workspacePath={workspaceAbsPath}
                    workspaceRemoteSessionId={workspaceRemoteSessionId}
                    activePreviewPath={activePreviewPath}
                    onSelectTask={handleSelectTaskInChat}
                    onSelectAcpSession={handleSelectAcpSession}
                    activeAcpSessionId={visibleAcpSession?.id}
                    onStartDraftInWorkspace={handleCreateProjectDraft}
                    onOpenCodeViewer={handleOpenCodeViewer}
                    onOpenBrowserUrl={handleOpenBrowserUrl}
                    fileTreeOpenRequest={fileTreeOpenRequest}
                    onCreateTask={handleCreateTaskInChat}
                    onCreateConversationTask={handleCreateConversationTaskInChat}
                    onOpenFolderFromWorkspaceMenu={onOpenFolderFromWorkspaceMenu}
                    onOpenRemoteWorkspace={onOpenRemoteWorkspace}
                    theme={theme}
                    onConnectRemote={onConnectRemote}
                    onSelectRemoteProject={onSelectRemoteProject}
                    onCancelRemoteProject={onCancelRemoteProject}
                    onReconnectRemoteWorkspace={onReconnectRemoteWorkspace}
                    reconnectingRemoteWorkspaceKeys={reconnectingRemoteWorkspaceKeys}
                    remoteWorkspaceErrorByWorkspaceKey={remoteWorkspaceErrorByWorkspaceKey}
                    reconnectingRemoteWorkspaceLogsByWorkspaceKey={
                      reconnectingRemoteWorkspaceLogsByWorkspaceKey
                    }
                    onLogout={onLogout}
                    user={user}
                    isDesktop={isDesktop}
                    isMacDesktop={isMacDesktop}
                    isWindowsDesktop={isWindowsDesktop}
                    isSidebarVisible={isSidebarVisible}
                    onToggleSidebar={handleToggleSidebar}
                    toggleSidebarShortcutLabel={toggleSidebarShortcutLabel}
                    canGoBack={canPrimaryNavigationBack}
                    canGoForward={canTaskNavForward}
                    onGoBack={primaryNavigationBack}
                    onGoForward={handleTaskNavForward}
                    goBackShortcutLabel={goBackShortcutLabel}
                    goForwardShortcutLabel={goForwardShortcutLabel}
                    onOpenCommandCenter={handleOpenCommandCenter}
                    onOpenAutomations={handleOpenAutomations}
                    automationsActive={workspaceMainView === "automations"}
                    onOpenPluginStore={handleOpenPluginStore}
                    pluginStoreActive={workspaceMainView === "plugin-store"}
                    onOpenRepository={() => handleOpenRepository()}
                    repositoryActive={workspaceMainView === "repository"}
                    onOpenAgentBoard={handleOpenAgentBoard}
                    agentBoardActive={workspaceMainView === "agent-board"}
                    onOpenWorkTasks={() => handleOpenWorkTasks()}
                    workTasksActive={workspaceMainView === "work-tasks"}
                    onFileTreeOpenChange={setIsSidebarFileTreeOpen}
                  />
                </WorkflowRunOpenProvider>
              </V4SplitPaneEntryProvider>
            </ScopedErrorBoundary>
          </aside>
        </div>

        {isSidebarVisible ? (
          <div
            role="separator"
            tabIndex={0}
            aria-controls="sidebar"
            aria-label={workspaceSidebarResizeLabel}
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_SIDEBAR_MIN_WIDTH_PX}
            aria-valuenow={Math.round(workspaceSidebarPanelWidthPx)}
            data-testid="resizable-handle"
            onKeyDown={handleWorkspaceSidebarResizeKeyDown}
            onPointerCancel={(event) => finishWorkspaceSidebarResize(event, true)}
            onPointerDown={handleWorkspaceSidebarResizeStart}
            onPointerMove={handleWorkspaceSidebarResizeMove}
            onPointerUp={(event) => finishWorkspaceSidebarResize(event)}
            className={cn(
              "group/handle relative z-10 flex h-full w-1 shrink-0 touch-none cursor-ew-resize items-center justify-center bg-transparent outline-none [app-region:no-drag] focus:outline-none focus-visible:ring-0",
              "after:pointer-events-none after:absolute after:rounded-full after:bg-foreground-subtlest/50 after:opacity-0 after:transition-opacity after:content-[''] after:inset-y-[var(--workspace-panel-radius)] after:w-0.5",
              "hover:after:opacity-100 data-[separator=hover]:after:opacity-100 data-[separator=active]:after:opacity-100 focus-visible:after:opacity-100 [[data-workspace-sidebar-resizing=true]_&]:after:opacity-100",
              hasDesktopPanelInset && "after:inset-y-[var(--workspace-resize-handle-inset)]",
            )}
          />
        ) : null}
        {/* 右侧主工作区：上方 header，下面左侧会话+终端，右侧共享 browser/code-viewer 槽位 */}
        <div
          data-panel=""
          id="content"
          className={cn(
            "relative flex flex-1 flex-col",
            // 手机侧栏展开后剩余宽度不足 320px；允许主区收缩，避免撑宽外壳并被标签/焦点滚动裁切导航。
            isDesktop ? "min-w-[320px]" : "min-w-0 md:min-w-[320px]",
            hasDesktopPanelInset ? "p-1 pl-0 pt-0" : "p-0",
          )}
        >
          {
            hasDesktopPanelInset && (
              <div className="h-1 w-full [app-region:drag]" />
            ) /* 修复 macOS 顶部窗口控制按钮被 header 遮挡无法点击的问题 */
          }
          <ResizablePanelGroup
            layoutId="workspace-body-layout"
            panelIds={WORKSPACE_BODY_PANEL_IDS}
            className="min-h-0 flex-1"
          >
            <ResizablePanel
              id="conversation-column"
              minSize="35%"
              defaultSize={isSidePaneVisible ? "52%" : undefined}
            >
              <ResizablePanelGroup
                orientation="vertical"
                layoutId="workspace-conversation-column-layout"
                panelIds={WORKSPACE_CONVERSATION_PANEL_IDS}
                className="h-full min-h-0"
              >
                <ResizablePanel
                  id="conversation"
                  elementRef={conversationPanelElementRef}
                  minSize="35%"
                >
                  <section
                    data-workspace-conversation-frame="true"
                    className={cn(
                      "relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background",
                      shouldReserveWebNavigationSpace && "pt-14",
                      isSidePaneVisible
                        ? "rounded-[var(--workspace-panel-radius)] border border-border"
                        : resolveWorkspaceShellWindowChromeClass({
                            isMacDesktop,
                            isWindowsDesktop,
                            isLinuxDesktop,
                            macOSMajorVersion: desktopWindowChromeState?.macOSMajorVersion,
                            isWindowsMaximized: desktopWindowChromeState?.isMaximized ?? false,
                            supportsNativeRoundedCorners:
                              desktopWindowChromeState?.supportsNativeRoundedCorners ?? null,
                          }),
                      isTerminalVisible && "rounded-b-[var(--workspace-panel-radius)] border-b",
                    )}
                  >
                    {shouldRenderWorkspaceHeader ? (
                      <ScopedErrorBoundary
                        scope="workspace-header"
                        resetKeys={workspaceOnlyResetKeys}
                        variant="compact"
                        className="border-b"
                      >
                        <WorkspaceHeader
                          onConversationTabsContainerChange={setConversationTabsContainer}
                          reserveWindowControls={!isSidePaneVisible}
                          variant={
                            acpHeaderTitle ? "acp" : activeTaskId === null ? "draft" : "task"
                          }
                          acpTitle={acpHeaderTitle}
                          draftDropTargetController={
                            activeTaskId === null ? draftHeaderDropTargetController : undefined
                          }
                          readOnlyReason={workspaceReadOnlyReason}
                          workspaceAbsPath={workspaceAbsPath}
                          remoteSessionId={workspaceRemoteSessionId}
                          workspaceIdentity={workspaceIdentity}
                          remoteTarget={workspaceRemoteTarget}
                          localWorkspacePath={workspaceLocalPathForRemoteMcpSync}
                          projectName={projectName}
                          activeTaskTitle={activeTaskTitle}
                          activeTaskChangeSummary={activeTaskChangeSummary}
                          hasUpdateReady={hasUpdateStatusButton}
                          activeTaskId={activeTaskId}
                          user={user}
                          activeTraceId={activeTraceId}
                          activeSessionId={activeSessionId}
                          activeTaskProvider={activeTaskProvider}
                          resolvedActiveTaskMeta={resolvedActiveTaskMeta}
                          sessionLogPath={taskSessionFile.path}
                          nativeSessionLogProvider={taskNativeSessionLogFile.provider}
                          nativeSessionLogPath={taskNativeSessionLogFile.path}
                          nativeSessionLogExists={taskNativeSessionLogFile.exists}
                          nativeSessionLogLoading={taskNativeSessionLogFile.loading}
                          workspaceHeaderState={workspaceShellZCodeState}
                          gitSummary={gitState.summary}
                          gitDirtyFileCount={gitDirtyFileCount}
                          isMacDesktop={isMacDesktop}
                          isMacFullscreen={isMacFullscreen}
                          isWindowsDesktop={isWindowsDesktop}
                          windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
                          isDesktop={isDesktop}
                          isSidebarVisible={isSidebarVisible}
                          isTerminalOpen={isTerminalOpen}
                          isSidePaneOpen={isSidePaneOpen}
                          onRefreshGit={handleRefreshGit}
                          onToggleTerminal={handleToggleTerminal}
                          onToggleBrowser={handleToggleBrowser}
                          onToggleSidePane={handleToggleSidePane}
                          toggleSidePaneShortcutLabel={toggleSidePaneShortcutLabel}
                          onReloadSession={handleReloadSession}
                          reloadSessionDisabled={workspaceSessionActionDisabled}
                          reloadSessionPending={reloadSessionPending}
                          onCreateTask={handleCreateTaskInChat}
                          onOpenWorkspace={onOpenWorkspace}
                          allowOpenWorkspace={allowOpenWorkspace}
                        />
                      </ScopedErrorBoundary>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {workspaceMainView === "automations" ? (
                        <main
                          id={AUTOMATIONS_TOAST_ANCHOR_ID}
                          className="flex h-full min-h-0 flex-1 flex-col bg-background"
                        >
                          <AutomationsMainBreadcrumbFrame
                            isDesktop={Boolean(isDesktop)}
                            sectionLabel={intl.formatMessage({
                              id: "settings.automations.title",
                            })}
                            ariaLabel={intl.formatMessage({
                              id: "automations.breadcrumbLabel",
                            })}
                          >
                            <div
                              // 不同 Automations tab 的内容高度不同，滚动条出现/消失会改变
                              // mx-auto 内容列的可用宽度，造成整页左右弹动；预留稳定槽位保持居中基准不变。
                              className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
                            >
                              <ScopedErrorBoundary
                                scope="automations-main"
                                resetKeys={workspaceOnlyResetKeys}
                                variant="panel"
                                className="min-h-full"
                              >
                                <div className="mx-auto flex w-full max-w-5xl flex-col px-4 py-4 md:px-6 md:py-6">
                                  <AutomationsSection
                                    workspacePath={workspaceAbsPath}
                                    workspaceIdentity={workspaceIdentity}
                                    onCreateViaChat={handleCreateAutomationInChat}
                                    onNavigateToLaunchedRun={handleNavigateToLaunchedRun}
                                    onOpenWorkflowRun={handleOpenSavedWorkflowRun}
                                    onOpenWorkflowArtifact={handleOpenSavedWorkflowArtifact}
                                    openAutomationId={openAutomationId}
                                    openAutomationTab={openAutomationTab}
                                    onOpenAutomationConsumed={onOpenAutomationConsumed}
                                    onOpenSession={({
                                      sessionId,
                                      workspacePath,
                                      workspaceIdentity,
                                    }) =>
                                      handleSelectTaskInChat(
                                        workspacePath,
                                        sessionId,
                                        workspaceIdentity,
                                      )
                                    }
                                  />
                                </div>
                              </ScopedErrorBoundary>
                            </div>
                          </AutomationsMainBreadcrumbFrame>
                        </main>
                      ) : workspaceMainView === "plugin-store" ? (
                        <main className="flex h-full min-h-0 flex-1 flex-col bg-background">
                          <AutomationsMainBreadcrumbFrame
                            isDesktop={Boolean(isDesktop)}
                            sectionLabel={intl.formatMessage({
                              id: "workspace.openPluginsSettings",
                            })}
                            ariaLabel={intl.formatMessage({
                              id: "settings.breadcrumbLabel",
                            })}
                          >
                            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                              <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-4 md:px-6 md:py-6">
                                <PluginStorePage
                                  key={`plugin-store:${pluginStoreOpenVersion}`}
                                  workspacePath={workspaceAbsPath}
                                  workspaceIdentity={workspaceIdentity}
                                  onCreateTask={handleCreateTaskInChat}
                                  onManageInstalled={handleManageInstalledPlugins}
                                />
                              </div>
                            </div>
                          </AutomationsMainBreadcrumbFrame>
                        </main>
                      ) : workspaceMainView === "agent-board" ? (
                        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
                          <AutomationsMainBreadcrumbFrame
                            isDesktop={Boolean(isDesktop)}
                            sectionLabel={intl.formatMessage({ id: "agentBoard.title" })}
                            ariaLabel={intl.formatMessage({ id: "agentBoard.title" })}
                          >
                            <ScopedErrorBoundary
                              scope="agent-board-main"
                              resetKeys={workspaceOnlyResetKeys}
                              variant="panel"
                              className="h-full min-h-0"
                            >
                              <Suspense
                                fallback={
                                  <div role="status" className="p-6 text-ui-base">
                                    {intl.formatMessage({ id: "agentBoard.loading" })}
                                  </div>
                                }
                              >
                                <AgentBoardPanel
                                  workspaceTabs={workspaceTabs}
                                  onCreateSession={(tab) =>
                                    handleCreateProjectDraft(
                                      tab.workspacePath,
                                      tab.workspaceIdentity,
                                    )
                                  }
                                  onOpenSession={(item) => {
                                    if (item.kind === "work-task")
                                      handleOpenWorkTaskConversation(item.workTask);
                                    else if (item.kind === "acp")
                                      handleSelectAcpSession(item.session);
                                    else
                                      handleSelectTaskInChat(
                                        item.workspacePath,
                                        item.task.taskId,
                                        item.workspaceIdentity,
                                        item.remoteSessionId,
                                      );
                                  }}
                                  conversationOptions={{
                                    isDesktop: Boolean(isDesktop),
                                    onOpenBrowserUrl: handleOpenBrowserUrl,
                                    onOpenCodeViewer: handleOpenCodeViewer,
                                    onOpenFileLink: handleOpenMarkdownFileLink,
                                    onOpenBackgroundBash: handleOpenBackgroundBash,
                                    onOpenSubagentSession: handleOpenSubagentSession,
                                    onOpenSubagentDirectory: handleOpenSubagentDirectory,
                                    onSyncSubagentSessionTabs: handleSyncSubagentSessionTabs,
                                    onOpenSelectionSideChat: handleOpenSelectionSideChat,
                                    onOpenPlanDetail: handleOpenPlanDetail,
                                    onOpenWorkflowRun: handleOpenWorkflowRun,
                                    onOpenWorkflowArtifact: handleOpenWorkflowArtifact,
                                    onOpenWorkflowRunDirectory: handleOpenWorkflowRunDirectory,
                                    onOpenWorkflowActorSession: handleOpenWorkflowActorSession,
                                    onOpenWorkflowWorkspace: handleOpenWorkflowWorkspace,
                                  }}
                                />
                              </Suspense>
                            </ScopedErrorBoundary>
                          </AutomationsMainBreadcrumbFrame>
                        </main>
                      ) : workspaceMainView === "work-tasks" ? (
                        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
                          <AutomationsMainBreadcrumbFrame
                            isDesktop={Boolean(isDesktop)}
                            sectionLabel={intl.formatMessage({ id: "workTasks.title" })}
                            ariaLabel={intl.formatMessage({ id: "workTasks.title" })}
                          >
                            <ScopedErrorBoundary
                              scope="work-tasks-main"
                              resetKeys={workspaceOnlyResetKeys}
                              variant="panel"
                              className="h-full min-h-0"
                            >
                              <Suspense
                                fallback={
                                  <div
                                    role="status"
                                    className="p-6 text-ui-sm text-foreground-subtle"
                                  >
                                    {intl.formatMessage({ id: "workTasks.loading" })}
                                  </div>
                                }
                              >
                                <WorkTasksPanel
                                  workspacePath={workspaceAbsPath}
                                  workspaceIdentity={workspaceIdentity}
                                  remoteSessionId={workspaceRemoteSessionId}
                                  workspaceTabs={workspaceTabs}
                                  onWorkspaceToolTargetChange={workTaskTools?.onTargetChange}
                                  reviewContainer={workTaskReviewContainer}
                                  workspaceTools={{
                                    isDesktop,
                                    readOnlyReason: panelReadOnlyReason,
                                    remoteTarget: workspaceTabs.find(
                                      (tab) =>
                                        (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
                                        panelWorkspaceKey,
                                    )?.remoteTarget,
                                    isTerminalOpen,
                                    isSidePaneOpen: hasWorkspaceToolsView && isSidePaneOpen,
                                    onToggleTerminal: handleToggleTerminal,
                                    onToggleSidePane: handleToggleSidePane,
                                    onOpenReview: handleOpenGitReview,
                                    toggleSidePaneShortcutLabel,
                                  }}
                                  onOpenConversation={handleOpenWorkTaskConversation}
                                  onOpenNativeSession={({ workspacePath, sessionId }) =>
                                    handleSelectTaskInChat(workspacePath, sessionId)
                                  }
                                  conversationOptions={{
                                    statusPanel: {
                                      workspaceKey: gitState.workspaceKey,
                                      gitSummary: gitState.summary,
                                      gitLoading: gitState.loading,
                                      gitDirtyFileCount,
                                      gitWorktreeReviewSourceId,
                                      gitWorktreeChangeSummary,
                                      summaryPanelVariantOverride,
                                      onSummaryPanelVariantOverrideChange,
                                      onRefreshGit: handleRefreshGit,
                                      onOpenGitReview: handleOpenGitReview,
                                      onOpenWorkspacePath,
                                    },
                                    isDesktop: isDesktop === true,
                                    focused: isWorkspaceVisible,
                                    telemetryVisible: isWorkspaceVisible,
                                    onOpenBrowserUrl: handleOpenBrowserUrl,
                                    onOpenCodeViewer: handleOpenCodeViewer,
                                    onAutoOpenAssistantPptx: isDesktop
                                      ? handleAutoOpenAssistantPptx
                                      : undefined,
                                    onOpenBackgroundBash: handleOpenBackgroundBash,
                                    onOpenSubagentSession: handleOpenSubagentSession,
                                    onOpenSubagentDirectory: handleOpenSubagentDirectory,
                                    onSyncSubagentSessionTabs: handleSyncSubagentSessionTabs,
                                    onOpenSelectionSideChat: handleOpenSelectionSideChat,
                                    onOpenPlanDetail: handleOpenPlanDetail,
                                    onOpenWorkflowRun: handleOpenWorkflowRun,
                                    onOpenWorkflowArtifact: handleOpenWorkflowArtifact,
                                    onOpenWorkflowRunDirectory: handleOpenWorkflowRunDirectory,
                                    onOpenWorkflowActorSession: handleOpenWorkflowActorSession,
                                    onOpenWorkflowWorkspace: handleOpenWorkflowWorkspace,
                                  }}
                                />
                              </Suspense>
                            </ScopedErrorBoundary>
                          </AutomationsMainBreadcrumbFrame>
                        </main>
                      ) : workspaceMainView === "repository" ? (
                        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
                          <AutomationsMainBreadcrumbFrame
                            isDesktop={Boolean(isDesktop)}
                            sectionLabel={intl.formatMessage({ id: "repositoryPanel.title" })}
                            ariaLabel={intl.formatMessage({ id: "repositoryPanel.title" })}
                          >
                            <ScopedErrorBoundary
                              scope="repository-main"
                              resetKeys={workspaceOnlyResetKeys}
                              variant="panel"
                              className="h-full min-h-0"
                            >
                              <Suspense
                                fallback={
                                  <div
                                    role="status"
                                    className="p-6 text-ui-sm text-foreground-subtle"
                                  >
                                    {intl.formatMessage({ id: "repositoryPanel.loading" })}
                                  </div>
                                }
                              >
                                <RepositoryPanel
                                  active={isWorkspaceVisible}
                                  workspacePath={workspaceAbsPath}
                                  workspaceIdentity={workspaceIdentity}
                                  remoteSessionId={workspaceRemoteSessionId}
                                  workspaceTabs={workspaceTabs}
                                  onSelectProject={handleOpenRepository}
                                  onOpenTasks={handleOpenWorkTasks}
                                  theme={theme}
                                />
                              </Suspense>
                            </ScopedErrorBoundary>
                          </AutomationsMainBreadcrumbFrame>
                        </main>
                      ) : (
                        <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                          {renderChatFindDialog()}
                          <ScopedErrorBoundary
                            scope="workspace-chat"
                            resetKeys={workspaceDraftResetKeys}
                            variant="panel"
                            className="h-full"
                          >
                            {/* pane 绑定必须用原始选择态 activeTaskId，
                                  不能用 meta 派生的 activeSessionId——v4 createSession 刚建的会话
                                  不在 taskListCache/optimistic 缓存里，meta 解析为 null 会让 pane
                                  永远停在 draft。v4 语义下 sessionId ≡ taskId，meta 只服务 Header 显示。
                                  桌面主区升级为分屏宿主（Layout/Focus 两层）；primary pane
                                  绑定语义与 testid 契约（paneId=workspace-main）不变。 */}
                            <WorktreeDraftIntentContext.Provider value={worktreeDraftIntent}>
                              <V4WorkspaceChatArea
                                conversationTabsContainer={conversationTabsContainer}
                                readOnly={Boolean(workspaceReadOnlyReason)}
                                foregroundEnabled={isWorkspaceVisible}
                                workspacePath={workspaceAbsPath}
                                workspaceIdentity={workspaceIdentity}
                                isDesktop={isDesktop === true}
                                remoteSessionId={workspaceRemoteSessionId}
                                sessionId={activeTaskId}
                                primaryConversationBinding={shellWorkbenchBinding}
                                activeSelectionSideChatSessionId={activeSelectionSideChatSessionId}
                                provider={activeTaskProvider ?? undefined}
                                onSessionCreated={handleV4SessionCreated}
                                onSessionDeleted={handleV4SessionDeleted}
                                draftComposerHeader={draftComposerHeader}
                                onPrimaryDraftDropTargetControllerChange={
                                  setDraftHeaderDropTargetController
                                }
                                onPrimaryAcpSessionChange={handlePrimaryAcpSessionChange}
                                onPrimaryAcpSessionArchived={handlePrimaryAcpSessionArchived}
                                acpOpenRequest={acpOpenRequest}
                                gitSummary={gitState.summary}
                                gitDirtyFileCount={gitDirtyFileCount}
                                activeTaskChangeSummary={activeTaskChangeSummary}
                                gitWorktreeReviewSourceId={gitWorktreeReviewSourceId}
                                gitWorktreeChangeSummary={gitWorktreeChangeSummary}
                                summaryPanelVariantOverride={summaryPanelVariantOverride}
                                onSummaryPanelVariantOverrideChange={
                                  onSummaryPanelVariantOverrideChange
                                }
                                onRefreshGit={handleRefreshGit}
                                onOpenGitReview={handleOpenGitReview}
                                onOpenScopedGitReview={handleOpenScopedGitReview}
                                onOpenWorkspacePath={onOpenWorkspacePath}
                                allowWorktreeCreation={false}
                                onPaneActiveSessionChange={handlePaneActiveSessionChange}
                                onOpenBrowserUrl={handleOpenBrowserUrl}
                                onOpenAutomationsMain={handleOpenAutomations}
                                onOpenCodeViewer={handleOpenCodeViewer}
                                onAutoOpenAssistantPptx={
                                  isDesktop ? handleAutoOpenAssistantPptx : undefined
                                }
                                onOpenBackgroundBash={handleOpenBackgroundBash}
                                onOpenSubagentSession={handleOpenSubagentSession}
                                onOpenSubagentDirectory={handleOpenSubagentDirectory}
                                onSyncSubagentSessionTabs={handleSyncSubagentSessionTabs}
                                onOpenSelectionSideChat={handleOpenSelectionSideChat}
                                onOpenPlanDetail={handleOpenPlanDetail}
                                onOpenWorkflowRun={handleOpenWorkflowRun}
                                onOpenWorkflowArtifact={handleOpenWorkflowArtifact}
                                onOpenWorkflowRunDirectory={handleOpenWorkflowRunDirectory}
                                onOpenWorkflowActorSession={handleOpenWorkflowActorSession}
                                onOpenWorkflowWorkspace={handleOpenWorkflowWorkspace}
                                onOpenFileLink={handleOpenMarkdownFileLink}
                                conversationFindQuery={conversationFindQuery}
                                conversationFindActiveIndex={conversationFindActiveIndex}
                                conversationFindNavigationRequestId={
                                  conversationFindNavigationRequestId
                                }
                                onConversationFindMatchStateChange={
                                  onConversationFindMatchStateChange
                                }
                                searchResultHighlightRequest={activeSearchResultHighlightRequest}
                                onSearchResultHighlightDone={onSearchResultHighlightDone}
                              />
                            </WorktreeDraftIntentContext.Provider>
                          </ScopedErrorBoundary>
                        </main>
                      )}
                    </div>
                  </section>
                </ResizablePanel>
                {/* 与路由解耦：工具切换只改变目标和显隐，不能卸载已有终端。 */}
                <AnimatedTerminalPanel
                  frameClassName={cn(
                    isSidePaneVisible
                      ? "rounded-[var(--workspace-panel-radius)] border border-border"
                      : resolveWorkspaceShellWindowChromeClass({
                          isMacDesktop,
                          isWindowsDesktop,
                          isLinuxDesktop,
                          macOSMajorVersion: desktopWindowChromeState?.macOSMajorVersion,
                          isWindowsMaximized: desktopWindowChromeState?.isMaximized ?? false,
                          supportsNativeRoundedCorners:
                            desktopWindowChromeState?.supportsNativeRoundedCorners ?? null,
                        }),
                    "rounded-t-[var(--workspace-panel-radius)] border-t",
                  )}
                  services={panelServices}
                  workspaceAbsPath={panelWorkspacePath}
                  workspaceIdentity={panelWorkspaceIdentity}
                  openWorkspaceKeys={openWorkspaceKeys}
                  isVisible={hasWorkspaceToolsView && isTerminalVisible}
                  isWindowsDesktop={isWindowsDesktop}
                  panelRef={terminalPanelRef}
                  panelElementRef={terminalPanelElementRef}
                  onClose={() => setIsTerminalOpen(false)}
                  onOpenBrowserUrl={handleOpenBrowserUrl}
                />
              </ResizablePanelGroup>
            </ResizablePanel>
            {/* Browser Guest Host 必须与主视图路由解耦，避免 automations/plugin
                    切换时卸载 Guest；截图请求期间由上层临时展开真实面板承载可合成的 WebContents。 */}
            {sidePanePanel}
          </ResizablePanelGroup>
          {/* 手机展开侧栏后，外侧点击只用于收起；独立遮罩阻止底层按钮和输入框被误触。
              用实际工作区容器宽度判定窄屏，复用既有显隐 owner，不另存 mobile/open 状态。 */}
          {!isDesktop && isSidebarVisible ? (
            <button
              type="button"
              data-testid="mobile-sidebar-dismiss"
              aria-label={intl.formatMessage({ id: "workspaceSidebar.collapseSidebar" })}
              onClick={handleToggleSidebar}
              className="absolute inset-0 z-40 hidden bg-background/40 [app-region:no-drag] @max-[768px]/workspace-shell:block focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
          ) : null}
        </div>
        <ScopedErrorBoundary
          scope="desktop-top-overlay"
          resetKeys={workspaceSidebarVisibilityResetKeys}
          variant="silent"
        >
          <DesktopTopOverlay
            newTaskDisabledReason={workspaceReadOnlyReason}
            workspaceAbsPath={workspaceAbsPath}
            isMacDesktop={isMacDesktop}
            isMacFullscreen={isMacFullscreen}
            macWindowControlsLeftPaddingPx={macWindowControlsLeftPaddingPx}
            windowsWindowControlsRightPaddingPx={windowsWindowControlsRightPaddingPx}
            isWindowsDesktop={isWindowsDesktop}
            isDesktop={isDesktop}
            isSidebarVisible={isSidebarVisible}
            updateReadyVersion={updateReadyVersion}
            updateState={updateState}
            toggleSidebarShortcutLabel={toggleSidebarShortcutLabel}
            newTaskShortcutLabel={newTaskShortcutLabel}
            goBackShortcutLabel={goBackShortcutLabel}
            goForwardShortcutLabel={goForwardShortcutLabel}
            canTaskNavBack={canPrimaryNavigationBack}
            canTaskNavForward={canTaskNavForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            showNewTaskButton={showTopOverlayNewTaskButton}
            platform={platform}
            onToggleSidebar={handleToggleSidebar}
            onCreateTask={handleCreateTaskInChat}
            onGoBack={primaryNavigationBack}
            onGoForward={handleTaskNavForward}
          />
        </ScopedErrorBoundary>
      </div>
    </DesktopWindowFrame>
  );
});
