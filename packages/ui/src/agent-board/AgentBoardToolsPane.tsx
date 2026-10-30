import { lazy, Suspense } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { GitChangeSourceId, WorkTaskScope } from "@zcode/shared";
import { Tabs, TabsContent } from "@/components/ui/tabs.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import type { GitPaneRepositoryState } from "@/hooks/useGitRepository.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { WorkspaceSidePaneState } from "@/lib/workspaceSidePane.js";
import { SidePaneTabsHeader } from "@/app-shell/SidePaneTabsHeader.js";
import { SidePaneFrame, SidePaneAddTabMenu } from "@/app-shell/SidePaneChrome.js";
import { WorkspaceSidePaneToggleButton } from "@/WorkspaceSidePaneToggleButton.js";
import { FileDiffIcon } from "lucide-react";

const GitPane = lazy(() => import("@/GitPane.js").then((module) => ({ default: module.GitPane })));
const PreviewPane = lazy(() =>
  import("@/PreviewPane.js").then((module) => ({ default: module.PreviewPane })),
);
const ignoreFindMatchCount = () => {};

export function AgentBoardToolsPane({
  state,
  scope,
  remoteSessionId,
  services,
  gitState,
  sourceId,
  isDesktop,
  onSelectSource,
  onActivateTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onReorderTab,
  onRefresh,
  onOpenCodeViewer,
  onOpenBrowserUrl,
  onOpenReview,
  onCollapse,
}: {
  state: WorkspaceSidePaneState;
  scope: WorkTaskScope;
  remoteSessionId?: string;
  services: IServiceAccessor;
  gitState: GitPaneRepositoryState;
  sourceId: GitChangeSourceId;
  isDesktop?: boolean;
  onOpenReview(): void;
  onCollapse(): void;
  onSelectSource(source: GitChangeSourceId): void;
  onActivateTab(id: string): void;
  onCloseTab(id: string): void;
  onCloseOtherTabs(id: string): void;
  onCloseAllTabs(): void;
  onReorderTab(activeId: string, overId: string): void;
  onRefresh(): void;
  onOpenCodeViewer(source: CodeViewerSource): void;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <aside data-testid="agent-board-side-pane" className="h-full min-h-0 min-w-0">
      <SidePaneFrame>
        <Tabs
          value={state.activeTabId}
          onValueChange={onActivateTab}
          className="h-full min-h-0 gap-0"
        >
          <SidePaneTabsHeader
            tabs={state.tabs}
            activeTabId={state.activeTabId}
            isDesktop={isDesktop}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
            onCloseOtherTabs={onCloseOtherTabs}
            onCloseAllTabs={onCloseAllTabs}
            onReorderTab={onReorderTab}
            addTabMenu={
              <SidePaneAddTabMenu
                items={[
                  {
                    id: "review",
                    label: intl.formatMessage({ id: "sidePane.review" }),
                    icon: FileDiffIcon,
                    onOpen: onOpenReview,
                  },
                ]}
              />
            }
            trailingControls={
              <WorkspaceSidePaneToggleButton isSidePaneOpen onToggleSidePane={onCollapse} />
            }
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <ServiceProvider services={services}>
              {state.tabs.map((tab) => (
                // 标签切换只改变可见性，不卸载 GitPane 的展开 diff 或会话草稿。
                <TabsContent
                  key={tab.id}
                  value={tab.id}
                  forceMount
                  data-testid={
                    tab.type === "git" ? "agent-board-git-review" : "agent-board-file-preview"
                  }
                  className="h-full min-h-0 min-w-0 data-[state=inactive]:hidden"
                >
                  <Suspense
                    fallback={
                      <p className="p-4 text-ui-base">
                        {intl.formatMessage({ id: "agentBoard.loading" })}
                      </p>
                    }
                  >
                    {tab.type === "git" ? (
                      <GitPane
                        workspacePath={scope.workspacePath}
                        workspaceIdentity={scope.workspaceIdentity}
                        workspaceRemoteSessionId={remoteSessionId}
                        gitState={gitState}
                        isDesktop={isDesktop}
                        selectedSourceId={sourceId}
                        onSelectSource={onSelectSource}
                        onClose={() => onCloseTab(tab.id)}
                        onRefresh={onRefresh}
                        fileChangeFindActiveIndex={0}
                        fileChangeFindNavigationRequestId={0}
                        fileChangeFindQuery=""
                        onFileChangeFindMatchCountChange={ignoreFindMatchCount}
                      />
                    ) : tab.type === "code-viewer" ? (
                      <PreviewPane
                        source={tab.source}
                        workspacePath={tab.source.workspacePath}
                        onClose={() => onCloseTab(tab.id)}
                        onOpenCodeViewer={onOpenCodeViewer}
                        onOpenBrowserUrl={onOpenBrowserUrl}
                      />
                    ) : null}
                  </Suspense>
                </TabsContent>
              ))}
            </ServiceProvider>
          </div>
        </Tabs>
      </SidePaneFrame>
    </aside>
  );
}
