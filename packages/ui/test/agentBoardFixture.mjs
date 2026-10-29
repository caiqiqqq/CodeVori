export const agentBoardFixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {AgentBoardPanel} from '../../../ui/src/agent-board/AgentBoardPanel.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {agentBoardStore} from '../../../ui/src/store/agentBoardStore.ts';
import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
import '../../../ui/src/styles.css';
window.__React=React;window.__remoteStore=useRemoteWorkspaceSessionStore;
const tabs=Array.from({length:24},(_,i)=>({id:'p'+i,kind:'workspace',workspacePath:i<2?'/same':'/fixture/project-'+i,label:i<2?'Same project':'Project '+i,...(i<2?{workspaceIdentity:'remote:'+i,remoteSessionId:'host-'+i}:{})}));
tabs[1].workspacePurpose='conversation';tabs[1].label='default';
tabs[22].workspacePurpose='conversation';tabs[22].workspacePath='/fixture/default';tabs[22].label='Internal chat cwd';
tabs[20].workspacePath='/fixture/project/default';tabs[20].label='default';
const native=tabs.map((tab,i)=>({...tab,taskId:'same-id',traceId:'fixture',title:i===0?'Remote API session':i===2?'Waiting for review':'Implement project '+i,createdAt:100,updatedAt:1000+i,mode:'guarded',status:i===3?'running':'completed',liveStatus:i===2?'waiting':i===3?'running':'completed',sourceAvailability:i===5?'offline':'online',provider:'API',model:i===23?undefined:'fixture-provider/model',boardCompletedAt:i===4?1004:undefined,pinned:i===6,archived:i===7}));
const acp=tabs.slice(0,2).map((tab,i)=>({...tab,id:'same-id',agent:i===0?'codex':'claude',title:'Remote ACP '+i,status:'idle',revision:1,entries:[{kind:'user',text:'Review remote implementation',createdAt:1100+i}],queue:{items:[]},history:{createdAt:100,updatedAt:1100+i}}));
const listeners=new Map(),commands=[],controllerListeners=new Set();
const providerSettings=key=>({getView:async()=>({revision:1,providers:[{providerId:'fixture-provider',effectiveConfig:{logo:{type:'builtin',key}},models:[],issues:[]}],providerOrder:[],providerTemplates:[]}),onDidChange:()=>({dispose(){}})});
const workRows=[],workListeners=new Set();
const workService={
 list:async scope=>({tasks:workRows.filter(t=>(t.workspaceIdentity??t.workspacePath)===(scope.workspaceIdentity??scope.workspacePath)).map(t=>({...t})),concurrency:1}),
 onDynamicChanged:()=>listener=>{workListeners.add(listener);return{dispose(){workListeners.delete(listener)}}},
 getResultSource:async()=>null,
 archive:async input=>{commands.push({kind:"work-task-archive",...input});const task=workRows.find(t=>t.id===input.id&&t.workspacePath===input.workspacePath);task.archived=input.archived;for(const l of workListeners)l();},
 complete:async input=>{commands.push({kind:'work-task-complete',...input});if(window.__board.rejectCompletion)throw Error('Synthetic acceptance failed');const task=workRows.find(t=>t.id===input.id&&(t.workspaceIdentity??t.workspacePath)===(input.workspaceIdentity??input.workspacePath));if(!task)throw Error('wrong task scope');task.status='done';task.updatedAt++;for(const l of workListeners)l();}
};
const servicesFor=tab=>({workTaskService:workService,providerSettingsService:providerSettings('deepseek'),acpService:{onDynamicSessionSummaryChanged:()=>listener=>{listeners.set(tab.workspaceIdentity??tab.workspacePath,listener);return{dispose(){listeners.delete(tab.workspaceIdentity??tab.workspacePath)}}},listSummaries:async()=>acp.filter(s=>(s.workspaceIdentity??s.workspacePath)===(tab.workspaceIdentity??tab.workspacePath)),updateRow:async input=>{commands.push({kind:'acp',...input});const row=acp.find(s=>s.id===input.id&&s.workspaceIdentity===input.workspaceIdentity);if(!row)throw Error('wrong host');if(input.action.kind==='pin')row.pinned=input.action.pinned;if(input.action.kind==='archive'){row.archived=input.action.archived;row.pinned=false;}if(input.action.kind==='completion')row.boardCompletedAt=input.action.completed?input.action.expectedUpdatedAt:undefined;row.revision++;listeners.get(row.workspaceIdentity)?.({kind:'upserted',session:{...row}});}}});
const services={workTaskService:workService,providerSettingsService:providerSettings('openai'),gitService:{getWorkspaceRepositoryInfo:async({workspacePath})=>({workspacePath,kind:'not-repository'})},acpService:{onDynamicSessionSummaryChanged:()=>()=>({dispose(){}}),listSummaries:async()=>[]},windowControllerService:{onDynamicControllerFrame:()=>listener=>{controllerListeners.add(listener);return{dispose(){controllerListeners.delete(listener)}}},subscribeControllerV4:async({topic})=>({ack:{subscriptionId:topic}}),unsubscribeControllerV4:async()=>{},listTaskList:async query=>{const items=native.filter(row=>query.workspaceScopes.some(scope=>(scope.workspaceIdentity??scope.workspacePath)===(row.workspaceIdentity??row.workspacePath))&&(query.kind==='archived'?row.archived:query.kind==='pinned'?row.pinned&&!row.archived:!row.archived&&!row.pinned));return{items:items.map(row=>({...row})),total:items.length,hasMore:false}},mutateTask:async input=>{if(window.__board.rejectWrites)throw Error('Host rejected stale action');commands.push({kind:'native',...input});const row=native.find(s=>s.taskId===input.address.taskId&&(s.workspaceIdentity??s.workspacePath)===(input.address.workspaceIdentity??input.address.workspacePath));if(!row)throw Error('wrong workspace');const m=input.mutation;if(m.kind==='pin')row.pinned=m.pinned;if(m.kind==='archive'){row.archived=m.archived;row.pinned=false;}if(m.kind==='board-completion')row.boardCompletedAt=m.completed?m.expectedUpdatedAt:undefined;return row;}}};
connectProviderSettingsSnapshot(services.providerSettingsService);
for(const tab of tabs.slice(0,2)){useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:tab.remoteSessionId,services:servicesFor(tab)});useRemoteWorkspaceSessionStore.getState().bindWorkspaceIdentity(tab.workspaceIdentity,tab.remoteSessionId);}
window.__board={updateAcp(index,patch){const row=acp[index];Object.assign(row,patch);row.revision++;listeners.get(row.workspaceIdentity??row.workspacePath)?.({kind:'upserted',session:{...row}});},workRows,notifyWork(){for(const l of workListeners)l();},commands,tabs,native,acp,store:agentBoardStore,services,update(index,patch){Object.assign(native[index],patch);const tab=tabs[index];useZCodeSessionStore.getState().bumpTaskListVersion(tab.workspacePath,tab.workspaceIdentity);}};
function Fixture(){const [selection,setSelection]=useState('');return <div className='h-dvh'><output data-testid='navigation'>{selection}</output><AgentBoardPanel workspaceTabs={tabs} onOpenSession={item=>setSelection(item.kind+':'+(item.workspaceIdentity??item.workspacePath))} onCreateSession={tab=>setSelection('new:'+tab.workspacePath)}/></div>}
createRoot(document.getElementById('root')).render(<TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider><PlatformProvider platform={{}}><TooltipProvider><Fixture/></TooltipProvider></PlatformProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>);
`;
