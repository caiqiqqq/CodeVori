export const workTaskAcceptanceFixture = `
    state.acceptanceReads=[];state.pendingAcceptance=[];state.pendingMerges=[];
    state.finishMerge=()=>state.pendingMerges.shift()?.();
    state.finishAcceptance=()=>{for(const resolve of state.pendingAcceptance.splice(0))resolve()};
    const acceptanceRead=async(r:any)=>{state.acceptanceReads.push(clone(r));if(state.delayAcceptance)await new Promise<void>(resolve=>state.pendingAcceptance.push(resolve));if(state.failAcceptance)throw new Error('Synthetic inspection failure')};
    services.gitService.getRepositorySummary=async(r:any)=>{await acceptanceRead(r);const task=state.tasks.find((t:any)=>t.worktree?.path===r.workspacePath);return {workspacePath:r.workspacePath,isRepository:!state.missingWorktree,isGitAvailable:true,branchName:task?.worktree?.branchName,isDirty:!!state.acceptanceChanges}};
    services.gitService.getChanges=async(r:any)=>{await acceptanceRead(r);return state.acceptanceChanges&&r.sourceId==='unstaged'?[{path:'src/fix.ts',isUntracked:true}]:[]};
    services.gitService.resolveLocalBranch=async(r:any)=>{await acceptanceRead(r);const task=state.tasks.find((t:any)=>t.worktree?.path===r.workspacePath);return {branchName:r.branchName,commitHash:state.acceptanceCommitted?'new-commit':task?.worktree?.baseCommit}};
`;
