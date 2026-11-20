export const workTaskWorkflowFixture = `
    state.workflows={};state.workflowDefinitions=new Map();const workflowListeners=new Set();
    service.listWorkflows=async()=>[...state.workflowDefinitions.values()];
    service.onDynamicWorkflowsChanged=()=>listener=>{workflowListeners.add(listener);return{dispose(){workflowListeners.delete(listener)}}};
    service.saveWorkflowDefinition=async r=>{state.workflowDefinitions.set(r.workflow.id,{workflow:clone(r.workflow),revision:r.expectedRevision+1,projectKeys:[]});for(const l of workflowListeners)l()};
    const workflowKey=(r:any)=>r.workspaceIdentity?.trim()||r.workspacePath;
    const workflowConfig=(r:any)=>state.workflows[workflowKey(r)]??{workflow:null,revision:0};
    const previousList=service.list;
    service.list=async(r:any)=>({...await previousList(r),workflow:clone(workflowConfig(r).workflow),workflowRevision:workflowConfig(r).revision});
    service.saveWorkflow=async(r:any)=>{
      state.calls.push({op:'saveWorkflow',...clone(r)});
      if(workflowConfig(r).revision!==r.expectedRevision)throw new Error('work-task.workflow-stale');
      state.workflows[workflowKey(r)]={workflow:clone(state.workflowDefinitions.get(r.workflowId)?.workflow??null),revision:r.expectedRevision+1};
      changed();return clone(state.workflows[workflowKey(r)]);
    };
    state.selectTestWorkflow=async()=>{
      const workflow={id:crypto.randomUUID(),name:'Delivery',stages:[
        {id:'build',name:'实现',owner:'Developer',instructions:'Implement feature',nextStageId:'review',execution:{kind:'api',mode:'build',modelSelection:modelView.preferredSelection}},
        {id:'review',name:'检查',owner:'Reviewer',instructions:'Check boundary cases',nextStageId:'accept',returnStageId:'build',execution:{kind:'acp',agent:'codex',config:[]}},
        {id:'accept',name:'验收',instructions:'Final acceptance'}
      ]};
      await service.saveWorkflowDefinition({workflow,expectedRevision:0});
      await service.saveWorkflow({workspacePath:'/synthetic/project',workflowId:workflow.id,expectedRevision:0});
    };
    const previousCreate=service.create;
    service.create=async(r:any)=>{
      const created=await previousCreate(r);const task=get(created);const definition=workflowConfig(r).workflow;
      if(definition){task.workflow={definition:clone(definition),currentStageId:definition.stages[0].id,history:[]};task.execution=clone(definition.stages[0].execution??task.execution)}
      changed();return clone(task);
    };
    service.transitionWorkflow=async(r:any)=>{
      state.calls.push({op:'transitionWorkflow',...clone(r)});const task=get(r);const workflow=task.workflow;
      if(task.status!=='review'||task.runSeq!==r.expectedRunSeq||workflow.currentStageId!==r.expectedStageId)throw new Error('work-task.workflow-transition-stale');
      const stage=workflow.definition.stages.find((item:any)=>item.id===r.targetStageId);
      const prior=workflow.definition.stages.find((item:any)=>item.id===workflow.currentStageId);
      workflow.history.push({stageId:prior.id,stageName:prior.name,owner:prior.owner,session:clone(task.session),worktree:clone(task.worktree),execution:clone(task.execution),runSeq:task.runSeq,targetStageId:stage.id,handoffNote:r.handoffNote,transitionedAt:Date.now()});
      workflow.currentStageId=stage.id;task.session=undefined;task.execution=clone(stage.execution??task.execution);task.sessionRequestId=crypto.randomUUID();
      start(task);task.session={kind:task.execution.kind,id:'session-'+task.id+'-'+task.runSeq};changed();return clone(task);
    };
`;
