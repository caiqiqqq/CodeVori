export const workTaskResultFixture = `
    state.pendingResults=[];state.resultCalls=[];
    state.finishResult=()=>state.pendingResults.shift()?.();
    services.workTaskService.generateResult=async(r:any)=>{state.resultCalls.push({op:'generate',...r});if(state.delayResult)await new Promise<void>(resolve=>state.pendingResults.push(resolve));if(state.failResult){state.failResult=false;throw new Error('work-task.result-model-unavailable')}return {text:'处理结果：已修复议题处理配置。\\n主要修改：复用智能体、模式和模型选择。\\n验证：类型检查和交互回归通过。'}};
    services.workTaskService.cancelResult=async(r:any)=>{state.resultCalls.push({op:'cancel',...r})};
`;
