export const workTaskResultFixture = `
    state.pendingResults=[];state.resultCalls=[];
    state.sourceOverrides={};state.pendingSources=[];state.finishSource=()=>state.pendingSources.shift()?.();
    state.resultSource=(id:string)=>state.sourceOverrides[id]??(state.tasks.find((task:any)=>task.id===id)?.execution.kind==='acp'
      ? {kind:'acp',agent:'codex',modelId:'conversation-codex',modelName:'Conversation Codex Model'}
      : {kind:'api',selection:{providerId:'conversation-provider',modelId:'conversation-model'}});
    services.workTaskService.getResultSource=async(r:any)=>{const source=state.resultSource(r.id);if(state.delaySource)await new Promise<void>(resolve=>state.pendingSources.push(resolve));return source};
    state.finishResult=()=>state.pendingResults.shift()?.();
    services.workTaskService.generateResult=async(r:any)=>{state.resultCalls.push({op:'generate',...r});if(state.delayResult)await new Promise<void>(resolve=>state.pendingResults.push(resolve));if(state.failResult){state.failResult=false;throw new Error('work-task.result-model-unavailable')}return {source:state.resultSource(r.id),text:'处理结果：已修复议题处理配置。\\n主要修改：复用智能体、模式和模型选择。\\n验证：类型检查和交互回归通过。'}};
    services.workTaskService.cancelResult=async(r:any)=>{state.resultCalls.push({op:'cancel',...r})};
`;
