import { agentBoardFixture } from "./agentBoardFixture.mjs";
// App's single-owner arrangement, with the real shared hook/renderer and synthetic services.
const imports = `
import {useRef} from 'react';
import {useAppPanels} from '../../../ui/src/hooks/useAppPanels.ts';
import {useWorkTaskWorkspaceTools} from '../../../ui/src/hooks/useWorkTaskWorkspaceTools.ts';
import {usePaneGitStatus} from '../../../ui/src/hooks/usePaneGitStatus.ts';
import {useWorkspaceServicesResolution} from '../../../ui/src/hooks/useWorkspaceServices.tsx';
import {AnimatedSidePanePanel} from '../../../ui/src/app-shell/AnimatedSidePanePanel.tsx';
import {ResizablePanelGroup,ResizablePanel} from '../../../ui/src/components/ui/resizable.tsx';
`;
const harness = `
function ToolsBoard(props){
 const projection=useWorkTaskWorkspaceTools({workspacePath:'/fixture/project-2'},true,'agent-board');
 const target=projection.target,scope=target??{workspacePath:'/fixture/project-2'};
 const {services:toolServices}=useWorkspaceServicesResolution(scope.workspacePath,scope.remoteSessionId,scope.workspaceIdentity);
 const panels=useAppPanels({workspaceAbsPath:scope.workspacePath,workspaceIdentity:scope.workspaceIdentity,workspaceRemoteSessionId:scope.remoteSessionId,activeTaskId:target?.nativeSessionId??null,sidePaneOwnerId:target?.sidePaneOwnerId??null,supportsEmbeddedBrowser:true,defaultWhiteboardNamePrefix:'Board'});
 window.__panels=panels;window.__toolsTarget=target;
 const [source,setSource]=useState('unstaged');
 const panelRef=useRef(null),panelElementRef=useRef(null);
 React.useEffect(()=>{const id=requestAnimationFrame(()=>{if(panels.isSidePaneCollapsed)panelRef.current?.collapse();else panelRef.current?.resize('48%')});return()=>cancelAnimationFrame(id)},[panels.isSidePaneCollapsed]);
 const openReview=(_scope,id)=>{setSource(id??'unstaged');panels.handleOpenGit()};
 const {gitState,...git}=usePaneGitStatus(scope,!!target,openReview,panels.sidePaneState?.tabs.some(t=>t.type==='git'));
 const onFile=target=>panels.handleOpenCodeViewer({type:'file',title:target.path.split('/').pop(),...target});
 const onToggle=panels.handleToggleSidePaneCollapse;
 const tools={...projection,isOpen:!panels.isSidePaneCollapsed,onToggle,actions:{...git,onOpenCodeViewer:panels.handleOpenCodeViewer,onOpenFileLink:onFile},header:{isDesktop:false,isTerminalOpen:false,isSidePaneOpen:!panels.isSidePaneCollapsed,onToggleTerminal:panels.handleOpenTerminalTab,onToggleSidePane:onToggle}};
 const options={onOpenCodeViewer:panels.handleOpenCodeViewer,onOpenFileLink:onFile,onOpenBrowserUrl:panels.handleOpenBrowserUrl,onOpenBackgroundBash:panels.handleOpenBackgroundBash,onOpenSubagentSession:panels.handleOpenSubagentSession,onOpenSubagentDirectory:panels.handleOpenSubagentDirectory,onSyncSubagentSessionTabs:panels.handleSyncSubagentSessionTabs,onOpenSelectionSideChat:panels.handleOpenSelectionSideChat,onOpenPlanDetail:panels.handleOpenPlanDetail,onOpenWorkflowRun:panels.handleOpenWorkflowRun,onOpenWorkflowArtifact:panels.handleOpenWorkflowArtifact,onOpenWorkflowRunDirectory:panels.handleOpenWorkflowRunDirectory,onOpenWorkflowActorSession:panels.handleOpenWorkflowActorSession,onOpenWorkflowWorkspace:panels.handleOpenWorkflowWorkspace};
 return <ResizablePanelGroup layoutId='fixture-tools' panelIds={['conversation-column','browser']} className={target&&!panels.isSidePaneCollapsed?'@max-[768px]/workspace-shell:[&>#conversation-column]:hidden! @max-[768px]/workspace-shell:[&>#browser]:flex-1! @max-[768px]/workspace-shell:[&>[data-workspace-side-pane-resize-handle]]:hidden!':''}><ResizablePanel id='conversation-column' minSize='0px'><AgentBoardPanel {...props} workspaceTools={tools} conversationOptions={options}/></ResizablePanel><ServiceProvider services={toolServices}><AnimatedSidePanePanel services={toolServices} isDesktop={false} isVisible={!!target&&!panels.isSidePaneCollapsed} sidePaneState={panels.sidePaneState} recentClosedSidePaneTabs={panels.recentClosedSidePaneTabs} isBrowserOpen={panels.sidePaneState?.tabs.find(t=>t.id===panels.sidePaneState.activeTabId)?.type==='browser'} supportsEmbeddedBrowser workspaceAbsPath={scope.workspacePath} workspaceIdentity={scope.workspaceIdentity} workspaceRemoteSessionId={scope.remoteSessionId} activeTaskId={target?.nativeSessionId??null} sidePaneOwnerId={target?.sidePaneOwnerId??null} gitState={gitState} activeGitSourceId={source} panelRef={panelRef} panelElementRef={panelElementRef} browserNavigationRequest={panels.browserNavigationRequest} browserRestoreUrls={{}} fileChangeFindActiveIndex={0} fileChangeFindNavigationRequestId={0} fileChangeFindQuery='' onFileChangeFindMatchCountChange={()=>{}} onCloseCodeViewer={panels.handleCloseCodeViewer} onCloseGit={panels.handleCloseGit} onActivateTab={panels.handleActivateSidePaneTab} onReorderTab={panels.handleReorderSidePaneTab} onCloseTab={panels.handleCloseSidePaneTab} onCloseOtherTabs={panels.handleCloseOtherSidePaneTabs} onCloseAllTabs={panels.handleCloseAllSidePaneTabs} onReopenClosedTab={panels.handleReopenClosedSidePaneTab} onOpenBrowserTab={panels.handleOpenBrowserTab} onOpenWhiteboard={panels.handleOpenWhiteboard} onOpenDeveloperTools={panels.handleOpenDeveloperTools} onOpenTerminalTab={panels.handleOpenTerminalTab} onOpenReviewTab={()=>panels.handleOpenGit()} onOpenSelectionSideConversation={()=>{}} onOpenBrowserUrl={panels.handleOpenBrowserUrl} onOpenCodeViewer={panels.handleOpenCodeViewer} onOpenSubagentSession={panels.handleOpenSubagentSession} onRefreshGit={git.onRefreshGit} onBrowserNavigationRequestHandled={panels.handleBrowserNavigationRequestHandled} onBrowserUrlChange={()=>{}} onBrowserPageMetadataChange={panels.handleBrowserPageMetadataChange} onSelectGitSource={setSource} onCloseSidePane={onToggle}/></ServiceProvider></ResizablePanelGroup>
}
`;
export const agentBoardToolsFixture =
  imports +
  agentBoardFixture
    .replace("function Fixture(){", harness + "\nfunction Fixture(){")
    .replace("<AgentBoardPanel workspaceTabs={tabs}", "<ToolsBoard workspaceTabs={tabs}")
    .replace("className='flex h-dvh'", "className='@container/workspace-shell flex h-dvh'")
    .replace(
      "const gitServices=host=>({fileService:",
      "const gitServices=host=>({terminalService:{create:async()=>({id:'fixture-terminal',shell:'zsh'}),dispose:async()=>{},resize:async()=>{},write:async()=>{},onDynamicData:()=>()=>({dispose(){}}),onDynamicExit:()=>()=>({dispose(){}})},fileService:",
    );
