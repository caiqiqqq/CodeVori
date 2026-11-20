// Real side-pane hook, panel and native webview; only unrelated Host services are synthetic.
export const browserTabRebindFixture = `
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useAppPanels} from '../../../ui/src/hooks/useAppPanels.ts';
import {AnimatedSidePanePanel} from '../../../ui/src/app-shell/AnimatedSidePanePanel.tsx';
import {UnifiedBrowserView} from '../../../ui/src/browser-use/UnifiedBrowserView.tsx';
import {useTaskSidePaneMemoryBridge} from '../../../ui/src/app-shell/useTaskSidePaneMemoryBridge.ts';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {ResizablePanel,ResizablePanelGroup} from '../../../ui/src/components/ui/resizable.tsx';
import '../../../ui/src/styles.css';
const platform={...window.browserRebindBridge,onBrowserViewReady(callback){return window.browserRebindBridge.onBrowserViewReady(payload=>{callback(payload);window.__browserReadyCount=(window.__browserReadyCount??0)+1})}};
const services={settingService:{get:async()=>({embeddedBrowserViewportPreference:{mode:'normal',viewport:{width:1280,height:720},zoom:'fit'}})}};
const noop=()=>{};
function Fixture(){
 const [workspace,setWorkspace]=useState('/fixture/project-a'),[session,setSession]=useState('session-a');
 const [mainRestored,setMainRestored]=useState(false);
 const panelRef=useRef(null),panelElementRef=useRef(null);
 const panels=useAppPanels({workspaceAbsPath:workspace,activeTaskId:session,sidePaneOwnerId:session,isDesktop:true,supportsEmbeddedBrowser:true,defaultWhiteboardNamePrefix:'Board',platform});
 const {browserRestoreUrls,handleBrowserUrlChange}=useTaskSidePaneMemoryBridge({workspaceAbsPath:workspace,activeTaskId:session,gitSelectedSourceId:'unstaged',setGitSelectedSourceId:noop});
 const active=panels.sidePaneState?.tabs.find(tab=>tab.id===panels.sidePaneState.activeTabId);
 window.__browserRebind={panels,workspace,session,showMainRestore:()=>setMainRestored(true),switchWorkspace:()=>{setWorkspace(value=>value.endsWith('-a')?'/fixture/project-b':'/fixture/project-a')},switchSession:()=>setSession(value=>value==='session-a'?'session-b':'session-a')};
 useEffect(()=>{const id=requestAnimationFrame(()=>{if(panels.isSidePaneCollapsed)panelRef.current?.collapse();else panelRef.current?.resize('65%')});return()=>cancelAnimationFrame(id)},[panels.isSidePaneCollapsed]);
 if(mainRestored)return <div className="h-screen"><UnifiedBrowserView browserKey="main-restored" workspaceKey={workspace} sessionId={session} isVisible/></div>;
 return <div className="flex h-screen flex-col bg-background text-foreground">
  <div><button data-testid="open" onClick={()=>panels.handleOpenBrowserUrl(window.browserFixtureUrl)}>Open</button>
  <button data-testid="toggle" onClick={panels.handleToggleSidePaneCollapse}>Toggle pane</button>
  <button data-testid="session" onClick={window.__browserRebind.switchSession}>Switch session</button>
  <button data-testid="workspace" onClick={window.__browserRebind.switchWorkspace}>Switch workspace</button></div>
  <ResizablePanelGroup layoutId="browser-rebind" panelIds={['conversation-column','browser']} className="min-h-0 flex-1">
   <ResizablePanel id="conversation-column" minSize="0px"><p>Conversation {session} / {workspace}</p></ResizablePanel>
   <AnimatedSidePanePanel services={services} isDesktop={false} isVisible={!panels.isSidePaneCollapsed}
    sidePaneState={panels.sidePaneState} recentClosedSidePaneTabs={panels.recentClosedSidePaneTabs}
    isBrowserOpen={active?.type==='browser'} supportsEmbeddedBrowser workspaceAbsPath={workspace}
    activeTaskId={session} sidePaneOwnerId={session} gitState={{files:[],stagedFiles:[],branches:[]}}
    activeGitSourceId="unstaged" panelRef={panelRef} panelElementRef={panelElementRef}
    browserNavigationRequest={panels.browserNavigationRequest} browserRestoreUrls={browserRestoreUrls}
    fileChangeFindActiveIndex={0} fileChangeFindNavigationRequestId={0} fileChangeFindQuery=""
    onFileChangeFindMatchCountChange={noop} onCloseCodeViewer={panels.handleCloseCodeViewer}
    onCloseGit={panels.handleCloseGit} onActivateTab={panels.handleActivateSidePaneTab}
    onReorderTab={panels.handleReorderSidePaneTab} onCloseTab={panels.handleCloseSidePaneTab}
    onCloseOtherTabs={panels.handleCloseOtherSidePaneTabs} onCloseAllTabs={panels.handleCloseAllSidePaneTabs}
    onReopenClosedTab={panels.handleReopenClosedSidePaneTab} onOpenBrowserTab={panels.handleOpenBrowserTab}
    onOpenWhiteboard={panels.handleOpenWhiteboard} onOpenDeveloperTools={panels.handleOpenDeveloperTools}
    onOpenTerminalTab={panels.handleOpenTerminalTab} onOpenReviewTab={panels.handleOpenGit}
    onOpenSelectionSideConversation={noop} onOpenBrowserUrl={panels.handleOpenBrowserUrl}
    onOpenCodeViewer={panels.handleOpenCodeViewer} onOpenSubagentSession={panels.handleOpenSubagentSession}
    onRefreshGit={noop} onBrowserNavigationRequestHandled={panels.handleBrowserNavigationRequestHandled}
    onBrowserUrlChange={handleBrowserUrlChange} onBrowserPageMetadataChange={panels.handleBrowserPageMetadataChange}
    onSelectGitSource={noop} onCloseSidePane={panels.handleToggleSidePaneCollapse}/>
  </ResizablePanelGroup>
 </div>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="en-US"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`;
