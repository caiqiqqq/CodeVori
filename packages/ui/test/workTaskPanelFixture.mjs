export const workTaskPanelFixture = `
    function Fixture(){
      state.setLocale=useZCodeIntl().setLocale;
      const [version,setVersion]=useState(0);
      const [target,setTarget]=useState({workspacePath:'/synthetic/project',tabs:[...tabs,conversationTab]});
      const [reviewOpen,setReviewOpen]=useState(false);
      const [showCounts,setShowCounts]=useState(false);state.showCounts=setShowCounts;
      const [reviewContainer,setReviewContainer]=useState<HTMLElement|null>(null);
      state.remount=()=>setVersion(v=>v+1);
      state.listenerCount=()=>listeners.size;
      state.setWorkspace=(mode:string)=>setTarget({workspacePath:'/synthetic/default',tabs:mode==='none'?[conversationTab]:[...tabs,conversationTab]});
      return <ServiceProvider services={services}><div className='relative flex h-dvh min-w-0'>
        <style>{"@media (min-width:768px){.review-fixture{position:relative}}"}</style>
        {showCounts?<div className='absolute bottom-0 left-0 z-10'><WorkTasksSidebarButton projects={tabs.slice(0,1)}/></div>:null}
        <div className='min-w-0 flex-1'><WorkTasksPanel key={version} workspacePath={target.workspacePath} workspaceTabs={target.tabs} reviewContainer={reviewContainer} onWorkspaceToolTargetChange={toolTargetChanged}
          workspaceTools={{isTerminalOpen:false,isSidePaneOpen:reviewOpen,onOpenReview:()=>setReviewOpen(true),onToggleTerminal:()=>state.toolCalls.push({op:'terminal',target:clone(state.toolTarget)}),onToggleSidePane:()=>state.toolCalls.push({op:'side-pane',target:clone(state.toolTarget)})}}
          onOpenConversation={(task:any)=>state.calls.push({op:'conversation',task})}/></div>
        {reviewOpen?<aside data-testid='work-task-review-fixture' className='review-fixture absolute inset-y-0 right-0 z-20 flex w-96 max-w-full min-w-0 shrink-0 flex-col border-l border-border bg-background'>
          <header className='flex h-10 shrink-0 items-center justify-between border-b border-border px-3'>审查<button aria-label='关闭审查面板' onClick={()=>setReviewOpen(false)}>关闭</button></header>
          <div className='flex min-h-0 flex-1 flex-col'><div ref={setReviewContainer} className='contents'/><div className='min-h-0 flex-1 p-3 text-ui-sm'>Synthetic file changes</div></div>
        </aside>:null}
      </div></ServiceProvider>;
    }
`;

export { workTaskForgeServiceFixture } from "./workTaskForgeFixture.mjs";
