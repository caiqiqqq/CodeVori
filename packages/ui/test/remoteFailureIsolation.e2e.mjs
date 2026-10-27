import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__remote-isolation-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React from 'react';import {createRoot} from 'react-dom/client';import {useWorkspaceTaskLists} from '../../../ui/src/hooks/useWorkspaceTaskLists.ts';import {useModelProviders} from '../../../ui/src/hooks/useModelProviders.ts';import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
const test:any=window.__remoteTest={ensures:0,probes:[],failEnsure:false,localCalls:0,remoteCalls:0};const dispose=()=>({dispose(){}});
const tasks=(remote=false)=>({listPinnedTaskIds:async()=>[],listArchivedTasks:async()=>[],listPinnedTasks:async()=>[],listDeletedTaskIds:async()=>[],onDynamicWorkspaceEvent:()=>dispose,listTasks:async()=>{if(remote){test.remoteCalls++;throw Error('remote directory unavailable')}test.localCalls++;return [{taskId:'local-task',workspacePath:'/local',title:'LOCAL PROJECT TASK',provider:'zcode',status:'completed',createdAt:1,updatedAt:1}];}});
const agent={onDynamicSessionsIndexFrame:()=>dispose,onAgentRuntimeRestarted:dispose,helloConversationV4:()=>new Promise(()=>{})};
const services:any={zcodeTaskService:tasks(),zcodeAgentService:agent,fileService:{ensureConversationWorkspace:async()=>{test.ensures++;if(test.failEnsure)throw Error('unavailable');return {path:'/safe/local-default'};}},providerSettingsService:{onDidChange:dispose,getView:async()=>{throw Error('fixture view unavailable')},testModelConnectivity:async p=>{test.probes.push(p);return {success:true}}}};
useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:'remote-id',services:{zcodeTaskService:tasks(true),zcodeAgentService:{...agent}} as any});
const tabs:any=[{id:'local',kind:'workspace',workspacePath:'/local',label:'local'},{id:'remote',kind:'workspace',workspacePath:'/remote',workspaceIdentity:'remote:fixture',remoteSessionId:'remote-id',label:'remote'}];const limits={};
function Fixture(){const lists=useWorkspaceTaskLists({workspaceTabs:tabs,activeWorkspacePath:'/remote',activeWorkspaceIdentity:'remote:fixture',sortBy:'updated',visibleLimitByWorkspaceKey:limits,defaultVisibleLimit:10});test.lists=lists;const models=useModelProviders({workspacePath:'/remote',workspaceIdentity:'remote:fixture',connectivityWorkspaceRequired:true,connectivityUnavailableMessage:'local unavailable'});test.models=models;return <div>{lists.groups.flatMap(g=>g.items).map(t=><p key={t.taskId}>{t.title}</p>)}</div>}
createRoot(document.getElementById('root')!).render(<ServiceProvider services={services}><TabStoreProvider><Fixture/></TabStoreProvider></ServiceProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
  await page.getByText("LOCAL PROJECT TASK").waitFor();
  assert.ok((await page.evaluate(() => window.__remoteTest.remoteCalls)) > 0);
  assert.equal(
    (
      await page.evaluate(() =>
        window.__remoteTest.models.testModelConnectivity("provider", "model"),
      )
    ).success,
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.__remoteTest.probes), [
    { workspacePath: "/safe/local-default", providerId: "provider", modelId: "model" },
  ]);
  await page.evaluate(() => {
    window.__remoteTest.failEnsure = true;
  });
  assert.equal(
    (
      await page.evaluate(() =>
        window.__remoteTest.models.testModelConnectivity("provider", "model"),
      )
    ).error.message,
    "local unavailable",
  );
  assert.equal(await page.evaluate(() => window.__remoteTest.probes.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: active remote directory failure preserves local project tasks; remote-only settings test uses local default cwd; local directory failure never probes remote path.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
