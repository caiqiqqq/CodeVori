import { useState, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { cn } from "@/components/lib/utils.js";
import { TabsList } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import type { WorkspaceSidePaneTab } from "@/lib/workspaceSidePane.js";
import type { RecentClosedSidePaneTab } from "@/hooks/useAppPanels.js";
import { SidePaneTabOverview } from "./SidePaneTabOverview.js";
import {
  getSidePaneTabTitle,
  SidePaneTabDragOverlay,
  SortableSidePaneTabTrigger,
} from "./SidePaneTabTrigger.js";
import { useSidePaneTabStrip } from "./useSidePaneTabStrip.js";

const EMPTY_RECENT_TABS: RecentClosedSidePaneTab[] = [];

// 主界面和看板只提供标签状态与命令；布局、搜索和拖动反馈在这里统一维护。
export function SidePaneTabsHeader({
  tabs: visibleTabs,
  activeTabId: visibleActiveTabId,
  recentClosedTabs = EMPTY_RECENT_TABS,
  isDesktop,
  style,
  addTabMenu,
  trailingControls,
  onActivateTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onReorderTab,
  onReopenClosedTab,
}: {
  tabs: WorkspaceSidePaneTab[];
  activeTabId: string;
  recentClosedTabs?: RecentClosedSidePaneTab[];
  isDesktop?: boolean;
  style?: CSSProperties;
  addTabMenu?: ReactNode;
  trailingControls?: ReactNode;
  onActivateTab(id: string): void;
  onCloseTab(id: string): void;
  onCloseOtherTabs(id: string): void;
  onCloseAllTabs(): void;
  onReorderTab(activeId: string, overId: string): void;
  onReopenClosedTab?(id: string): void;
}) {
  const { intl } = useZCodeIntl();
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const { tabsScrollViewportRef, tabsScrollContentRef, isTabsOverflowing, tabsScrollMaskEdges } =
    useSidePaneTabStrip(visibleTabs, visibleActiveTabId);
  const tabDragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );

  const handleTabDragStart = (event: DragStartEvent) => {
    setDraggingTabId(String(event.active.id));
  };

  const handleTabDragEnd = (event: DragEndEvent) => {
    setDraggingTabId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    onReorderTab(String(active.id), String(over.id));
  };

  const handleTabDragCancel = () => {
    setDraggingTabId(null);
  };

  const sidePaneTabOverview = (
    <SidePaneTabOverview
      tabs={visibleTabs}
      activeTabId={visibleActiveTabId}
      recentClosedTabs={recentClosedTabs}
      labels={{
        title: intl.formatMessage({ id: "sidePane.tabOverview" }),
        searchPlaceholder: intl.formatMessage({
          id: "sidePane.searchTabs",
        }),
        openTabs: intl.formatMessage({ id: "sidePane.openTabs" }),
        recentlyClosedTabs: intl.formatMessage({
          id: "sidePane.recentlyClosedTabs",
        }),
        noResults: intl.formatMessage({ id: "sidePane.noTabsFound" }),
        closeTab: (title) => intl.formatMessage({ id: "sidePane.closeTab" }, { title }),
        relativeTime: (timestamp) => formatTaskRelativeTime(timestamp, intl),
        browserTitle: intl.formatMessage({ id: "browser.title" }),
        reviewTitle: intl.formatMessage({ id: "sidePane.review" }),
        codeViewerTitle: intl.formatMessage({ id: "codeViewer.title" }),
        treemappingTitle: intl.formatMessage({ id: "treemapping.title" }),
        whiteboardTitle: intl.formatMessage({ id: "whiteboard.title" }),
        modelTrajectoryTitle: intl.formatMessage({
          id: "modelTrajectory.title",
        }),
        acpTraceTitle: intl.formatMessage({ id: "acpTrace.title" }),
        developerToolsTitle: intl.formatMessage({
          id: "developerTools.title",
        }),
        terminalTitle: intl.formatMessage({ id: "terminal.title" }),
        subagentTypeLabel: intl.formatMessage({ id: "sidePane.subagent" }),
        subagentDirectoryTitle: intl.formatMessage({
          id: "sidePane.subagentDirectory",
        }),
        selectionChatTitle: intl.formatMessage({
          id: "sidePane.selectionChat",
        }),
        planTitle: intl.formatMessage({ id: "planTool.panel.planTab" }),
        workflowRunTitle: intl.formatMessage({ id: "sidePane.workflowRun" }),
        workflowDirectoryTitle: intl.formatMessage({ id: "sidePane.workflowDirectory" }),
        workflowActorTitle: intl.formatMessage({ id: "sidePane.workflowActor" }),
        workflowScriptTitle: intl.formatMessage({ id: "sidePane.workflowScript" }),
        workflowArtifactTitle: intl.formatMessage({ id: "sidePane.workflowArtifact" }),
      }}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
      onReopenClosedTab={onReopenClosedTab}
    />
  );
  const draggingTab = draggingTabId
    ? (visibleTabs.find((tab) => tab.id === draggingTabId) ?? null)
    : null;

  return (
    <TabsList
      style={style}
      className={cn(
        "flex justify-start w-full rounded-none p-0 border-0 border-b border-border/50 bg-transparent shadow-none !h-12 overflow-hidden",
        // 独立面板将标签栏移至窗口顶部，需补充窗口拖拽区域；标签和按钮仍处理自身交互。
        isDesktop &&
          "[app-region:drag] [&_button]:[app-region:no-drag] [&_[data-side-pane-tab-id]]:[app-region:no-drag]",
      )}
    >
      <div className="flex items-center justify-start flex-1 min-w-0">
        {/* 与 WorkspaceHeader 的 p-2 对齐，避免切换面板后左右操作区跳动。 */}
        <div className="flex h-full shrink-0 items-center p-2">{sidePaneTabOverview}</div>
        <DndContext
          sensors={tabDragSensors}
          collisionDetection={closestCenter}
          onDragStart={handleTabDragStart}
          onDragEnd={handleTabDragEnd}
          onDragCancel={handleTabDragCancel}
        >
          <div
            ref={tabsScrollViewportRef}
            data-side-pane-tabs-viewport=""
            className={cn(
              "min-w-0 flex-1 overflow-x-auto !scrollbar-hide h-12 items-center",
              tabsScrollMaskEdges.left &&
                tabsScrollMaskEdges.right &&
                "[mask-image:linear-gradient(to_right,transparent_0%,black_16px,black_calc(100%-16px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_16px,black_calc(100%-16px),transparent_100%)]",
              tabsScrollMaskEdges.left &&
                !tabsScrollMaskEdges.right &&
                "[mask-image:linear-gradient(to_right,transparent_0%,black_16px,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_16px,black_100%)]",
              !tabsScrollMaskEdges.left &&
                tabsScrollMaskEdges.right &&
                "[mask-image:linear-gradient(to_right,black_0%,black_calc(100%-16px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_0%,black_calc(100%-16px),transparent_100%)]",
            )}
          >
            {/* tab strip 固定占满滚动 viewport：每个 tab 先从 156px 等宽收缩到
                            60px，只有最小宽度之和仍超出 viewport 时才产生横向滚动。 */}
            <div
              ref={tabsScrollContentRef}
              data-side-pane-tabs-content=""
              className="flex w-full gap-1 py-2.5"
            >
              <SortableContext
                items={visibleTabs.map((tab) => tab.id)}
                strategy={horizontalListSortingStrategy}
              >
                {visibleTabs.map((tab) => {
                  const title = getSidePaneTabTitle(tab, intl.formatMessage);
                  return (
                    <SortableSidePaneTabTrigger
                      key={tab.id}
                      tab={tab}
                      title={title}
                      closeTabLabel={intl.formatMessage({ id: "sidePane.closeTab" }, { title })}
                      closeTabMenuLabel={intl.formatMessage({
                        id: "sidePane.closeCurrentTab",
                      })}
                      closeOtherTabsLabel={intl.formatMessage({
                        id: "sidePane.closeOtherTabs",
                      })}
                      closeAllTabsLabel={intl.formatMessage({
                        id: "sidePane.closeAllTabs",
                      })}
                      diffBadgeLabel={intl.formatMessage({
                        id: "diff.title",
                      })}
                      isActive={tab.id === visibleActiveTabId}
                      onActivateTab={onActivateTab}
                      onCloseTab={onCloseTab}
                      onCloseOtherTabs={onCloseOtherTabs}
                      onCloseAllTabs={onCloseAllTabs}
                      canCloseOtherTabs={visibleTabs.length > 1}
                    />
                  );
                })}
              </SortableContext>
              {!isTabsOverflowing ? addTabMenu : null}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {draggingTab ? (
              <SidePaneTabDragOverlay
                tab={draggingTab}
                title={getSidePaneTabTitle(draggingTab, intl.formatMessage)}
                diffBadgeLabel={intl.formatMessage({
                  id: "diff.title",
                })}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="ml-auto flex h-full shrink-0 items-center gap-1 px-2">
          {isTabsOverflowing ? addTabMenu : null}
          {trailingControls}
        </div>
      </div>
    </TabsList>
  );
}
