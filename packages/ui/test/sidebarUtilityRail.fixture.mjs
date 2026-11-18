import { writeFile } from "node:fs/promises";

// 只替换 Host 读取与列表叶子；侧栏布局、footer、按钮和远控弹层均使用真实组件。
export const sidebarFixtureModules = {
  "hooks/useWorkspaceTaskLists.ts": `const value={groups:[],loading:false};export function useWorkspaceTaskLists(){return value}`,
  "hooks/useWorktreeProjectGroups.ts": `const value={groups:[],resolvedGroups:[],loading:false};export function useWorktreeProjectGroupsResolution(){return value};export function useWorktreeProjectGroups(){return value.groups}`,
  "hooks/useRepositoryIssueCounts.ts": `export function useRepositoryIssueCounts(){return {count:0,loading:false,stale:false,partial:false}}`,
  "WorkspaceSidebarFooterUsageSummary.tsx": `export function useWorkspaceSidebarFooterUsageSummaryState(){return {}};export function WorkspaceSidebarFooterPlanBadge(){return null};export function WorkspaceSidebarFooterUsageSummaryContent(){return null}`,
  "WorkspacePinnedTasksSection.tsx": `export function WorkspacePinnedTasksSection(){return null}`,
  "WorkspaceGroupedTasksSection.tsx": `import React from 'react';export function WorkspaceGroupedTasksSection({onSelectTask}){return <div className="flex shrink-0 flex-col gap-1">{Array.from({length:40},(_,i)=><button key={i} data-testid={'fixture-task-'+i} className="h-8 shrink-0 truncate px-2 text-left text-ui-base hover:bg-hover" onClick={()=>{window.__rail.selected=i;onSelectTask('/fixture',String(i))}}>任务 {i+1} · Sidebar layout regression</button>)}</div>}`,
  "WorkspaceFileTree.tsx": `import React from 'react';export function WorkspaceFileTree({onClose}){return <div data-testid="fixture-file-tree" className="h-full bg-sidebar"><button onClick={onClose}>Close tree</button></div>}`,
  "BotsDialog.tsx": `export function BotsDialog(){return null}`,
};

export async function writeSidebarUtilityFixture(html, moduleFile, name) {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceSidebar} from '../../../ui/src/WorkspaceSidebar.tsx';
    import {WorkspaceSidebarFooter} from '../../../ui/src/WorkspaceSidebarFooter.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStore} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const noop=()=>{},broadcast={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={broadcastService:broadcast,settingService:{get:async()=>({}),update:async()=>{}}};
    const platform:any={isWeb:false};
    const state:any={selected:null};window.__rail=state;state.theme=applyTheme;
    localStorage.setItem('zcode-sidebar-task-preferences',JSON.stringify({organizeBy:'grouped',sortBy:'updated'}));
    function Fixture(){
      const [locale,setLocale]=useState('zh-CN'),[desktop,setDesktop]=useState(true),[tree,setTree]=useState(undefined),[footer,setFooter]=useState(false);
      state.locale=setLocale;state.desktop=setDesktop;state.tree=setTree;state.footer=setFooter;
      const tabs=useTabStore(s=>s.tabs),closeTab=useTabStore(s=>s.closeTab);state.settingsOpen=tabs.some(t=>t.kind==='settings');
      state.closeSettings=()=>tabs.filter(t=>t.kind==='settings').forEach(t=>closeTab(t.id));
      return <ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><div className="h-dvh bg-background"><main className="h-dvh w-full bg-background-alt text-foreground" style={{width:'min(100vw, 320px)'}}>
        {footer?<WorkspaceSidebarFooter theme='zai-dark' localeMenuValue='system' onLocaleChange={noop} onThemeChange={noop} showProfileMenu={false} onSettingsButtonClick={noop} workspacePath='/fixture' isDesktop={desktop}/>:
        <WorkspaceSidebar workspacePath='/fixture' theme='zai-dark' isDesktop={desktop} isMacDesktop={desktop} onSelectTask={noop} onStartDraftInWorkspace={noop} onCreateTask={noop} onCreateConversationTask={noop} onOpenCommandCenter={noop} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}} fileTreeOpenRequest={tree}/>}
      </main></div></TooltipProvider></ZCodeIntlProvider>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
}
