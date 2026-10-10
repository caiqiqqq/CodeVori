export const workTaskForgeServiceFixture = `
      async complete(r:any){
        state.calls.push({op:'complete',...r});
        if(state.delayComplete){state.delayComplete=false;await new Promise<void>(resolve=>state.pendingCompletions.push(resolve))}
        if(state.failComplete){state.failComplete=false;throw new Error('Synthetic completion failed')}
        const task=get(r);
        if(task.status==='review'){
          if(task.stopPending||(task.merge&&!['merged','failed','canceled'].includes(task.merge.phase)))throw new Error('work-task.not-reviewable');
          task.status='done';task.completion='accepted_without_merge';
          if(r.forge){task.forgeWriteback={...r.forge,id:crypto.randomUUID(),runSeq:task.runSeq,commentState:r.forge.comment?'done':'skipped',closeState:r.forge.closeIssue?'pending':'skipped'};if(r.forge.comment)state.calls.push({op:'forge-comment'})}
        }else if(task.status!=='done'||!task.forgeWriteback)throw new Error('work-task.not-reviewable');
        if(task.forgeWriteback&&['pending','failed'].includes(task.forgeWriteback.closeState)){
          state.calls.push({op:'forge-close'});
          if(state.failForgeClose){state.failForgeClose=false;task.forgeWriteback.closeState='failed';task.forgeWriteback.error='FORGE_FORBIDDEN';changed();throw new Error('FORGE_FORBIDDEN')}
          task.forgeWriteback.closeState='done';task.forgeWriteback.error=undefined;
        }
        changed();return clone(task);
      },
`;
