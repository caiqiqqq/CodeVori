// Real board components/data hooks and command routing; synthetic Host and chat pane.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-${process.pid}`;
const html = join(renderer, name + ".html"),
  moduleFile = join(renderer, name + ".tsx");
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5174";
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AgentBoardPanel} from '../../../ui/src/agent-board/AgentBoardPanel.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {agentBoardStore} from '../../../ui/src/store/agentBoardStore.ts';
import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
import '../../../ui/src/styles.css';
window.__React=React;window.__remoteStore=useRemoteWorkspaceSessionStore;
const tabs=Array.from({length:24},(_,i)=>({id:'p'+i,kind:'workspace',workspacePath:i<2?'/same':'/fixture/project-'+i,label:i<2?'Same project':'Project '+i,...(i<2?{workspaceIdentity:'remote:'+i,remoteSessionId:'host-'+i}:{})}));
const native=tabs.map((tab,i)=>({...tab,taskId:'same-id',traceId:'fixture',title:i===0?'Remote API session':i===2?'Waiting for review':'Implement project '+i,createdAt:100,updatedAt:1000+i,mode:'guarded',status:i===3?'running':'completed',liveStatus:i===2?'waiting':i===3?'running':'completed',sourceAvailability:i===5?'offline':'online',provider:'API',boardCompletedAt:i===4?1004:undefined,pinned:i===6,archived:i===7}));
const acp=tabs.slice(0,2).map((tab,i)=>({...tab,id:'same-id',agent:i===0?'codex':'claude',title:'Remote ACP '+i,status:'idle',revision:1,entries:[{kind:'user',text:'Review remote implementation',createdAt:1100+i}],queue:{items:[]},history:{createdAt:100,updatedAt:1100+i}}));
const listeners=new Map(),commands=[],controllerListeners=new Set();
const servicesFor=tab=>({acpService:{onDynamicSessionSummaryChanged:()=>listener=>{listeners.set(tab.workspaceIdentity??tab.workspacePath,listener);return{dispose(){listeners.delete(tab.workspaceIdentity??tab.workspacePath)}}},listSummaries:async()=>acp.filter(s=>(s.workspaceIdentity??s.workspacePath)===(tab.workspaceIdentity??tab.workspacePath)),updateRow:async input=>{commands.push({kind:'acp',...input});const row=acp.find(s=>s.id===input.id&&s.workspaceIdentity===input.workspaceIdentity);if(!row)throw Error('wrong host');if(input.action.kind==='pin')row.pinned=input.action.pinned;if(input.action.kind==='archive'){row.archived=input.action.archived;row.pinned=false;}if(input.action.kind==='completion')row.boardCompletedAt=input.action.completed?input.action.expectedUpdatedAt:undefined;row.revision++;listeners.get(row.workspaceIdentity)?.({kind:'upserted',session:{...row}});}}});
const services={gitService:{getWorkspaceRepositoryInfo:async({workspacePath})=>({workspacePath,kind:'not-repository'})},acpService:{onDynamicSessionSummaryChanged:()=>()=>({dispose(){}}),listSummaries:async()=>[]},windowControllerService:{onDynamicControllerFrame:()=>listener=>{controllerListeners.add(listener);return{dispose(){controllerListeners.delete(listener)}}},subscribeControllerV4:async({topic})=>({ack:{subscriptionId:topic}}),unsubscribeControllerV4:async()=>{},listTaskList:async query=>{const items=native.filter(row=>query.workspaceScopes.some(scope=>(scope.workspaceIdentity??scope.workspacePath)===(row.workspaceIdentity??row.workspacePath))&&(query.kind==='archived'?row.archived:query.kind==='pinned'?row.pinned&&!row.archived:!row.archived&&!row.pinned));return{items:items.map(row=>({...row})),total:items.length,hasMore:false}},mutateTask:async input=>{if(window.__board.rejectWrites)throw Error('Host rejected stale action');commands.push({kind:'native',...input});const row=native.find(s=>s.taskId===input.address.taskId&&(s.workspaceIdentity??s.workspacePath)===(input.address.workspaceIdentity??input.address.workspacePath));if(!row)throw Error('wrong workspace');const m=input.mutation;if(m.kind==='pin')row.pinned=m.pinned;if(m.kind==='archive'){row.archived=m.archived;row.pinned=false;}if(m.kind==='board-completion')row.boardCompletedAt=m.completed?m.expectedUpdatedAt:undefined;return row;}}};
for(const tab of tabs.slice(0,2)){useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:tab.remoteSessionId,services:servicesFor(tab)});useRemoteWorkspaceSessionStore.getState().bindWorkspaceIdentity(tab.workspaceIdentity,tab.remoteSessionId);}
window.__board={commands,tabs,native,acp,store:agentBoardStore,services,update(index,patch){Object.assign(native[index],patch);const tab=tabs[index];useZCodeSessionStore.getState().bumpTaskListVersion(tab.workspacePath,tab.workspaceIdentity);}};
function Fixture(){const [selection,setSelection]=useState('');return <div className='h-dvh'><output data-testid='navigation'>{selection}</output><AgentBoardPanel workspaceTabs={tabs} onOpenSession={item=>setSelection(item.kind+':'+(item.workspaceIdentity??item.workspacePath))} onCreateSession={tab=>setSelection('new:'+tab.workspacePath)}/></div>}
createRoot(document.getElementById('root')).render(<ServiceProvider services={services}><ZCodeIntlProvider><Fixture/></ZCodeIntlProvider></ServiceProvider>);
`,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
    console.error(error);
  });
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(props){window.__pane=props;return window.__React.createElement('div',{'data-testid':'real-pane-contract','data-native-id':props.sessionId??'','data-acp-id':props.acpBoundSessionId??'','data-identity':props.workspaceIdentity??'','data-remote':props.remoteSessionId??'','data-readonly':String(props.readOnly)},'Synthetic chat transport');}`,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function V4PaneConversationProvider({scope,children}){window.__paneScope=scope;return children}`,
    }),
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.className = "theme-zai-light";
    });
  });
  await page.goto(origin + "/" + name + ".html");
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 25);
  assert.equal(
    await page.locator("[data-board-column]").count(),
    5,
    "24 projects use 5 status columns",
  );
  await page.screenshot({ path: join(artifacts, "desktop-light.png"), fullPage: true });
  await page.getByRole("tab", { name: /需关注/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 1);
  await page.getByRole("tab", { name: /全部/ }).click();
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("Remote");
  assert.equal(await page.locator("[data-board-card]").count(), 3);
  await page.getByRole("button", { name: /Remote API session/ }).click();
  const pane = page.getByTestId("real-pane-contract");
  await pane.waitFor();
  assert.equal(await pane.getAttribute("data-identity"), "remote:0");
  assert.equal(await pane.getAttribute("data-remote"), "host-0");
  await page.evaluate(() => (window.__board.rejectWrites = true));
  await page.getByRole("button", { name: "标记完成", exact: true }).click();
  await page.getByText("操作失败，会话状态可能已变化，请刷新后重试", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "标记完成", exact: true }).count(), 1);
  await page.evaluate(() => (window.__board.rejectWrites = false));
  await page.getByRole("button", { name: "标记完成", exact: true }).click();
  await page.getByRole("button", { name: "重新打开", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__board.commands.at(-1).address.workspaceIdentity),
    "remote:0",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Remote ACP 0/ }).click();
  await pane.waitFor();
  assert.equal(await pane.getAttribute("data-native-id"), "");
  assert.equal(await pane.getAttribute("data-acp-id"), "same-id");
  await page.getByRole("button", { name: "标记完成", exact: true }).click();
  await page.getByRole("button", { name: "重新打开", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__board.commands.at(-1).remoteSessionId), "host-0");
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "true",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.getByRole("tab", { name: /归档/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  await page.getByRole("button", { name: /Remote ACP 0/ }).click();
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "false",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /全部/ }).click();
  await page.evaluate(() => window.__board.update(0, { liveStatus: "waiting", updatedAt: 2100 }));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-board-column="waiting"]')
      ?.textContent.includes("Remote API session"),
  );
  await page.evaluate(() => window.__board.update(0, { liveStatus: "completed", updatedAt: 2100 }));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-board-column="idle"]')
      ?.textContent.includes("Remote API session"),
  );
  const nativeCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote API session", exact: true }) });
  await nativeCard.getByRole("button", { name: "收藏会话", exact: true }).click();
  await nativeCard.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  const acpCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 1", exact: true }) });
  await acpCard.getByRole("button", { name: "收藏会话", exact: true }).click();
  await acpCard.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  await page.evaluate(() => {
    const state = window.__remoteStore.getState();
    window.__disconnected = state.sessionsById["host-0"];
    state.unregisterSession("host-0");
  });
  await nativeCard.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  const disconnectedAcp = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 0", exact: true }) });
  await disconnectedAcp.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  assert.equal(
    await nativeCard.getByRole("button", { name: "取消收藏", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    const state = window.__remoteStore.getState();
    state.registerSession(window.__disconnected);
    state.bindWorkspaceIdentity("remote:0", "host-0");
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("article"))
        .find((row) => row.textContent.includes("Remote API session"))
        ?.textContent.includes("离线"),
  );
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("button", { name: "固定项目 Project 4", exact: true }).click();
  await page.getByRole("button", { name: "固定项目 Project 5", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "固定项目 Project 6", exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole("textbox", { name: "搜索项目名称或路径…", exact: true })
    .fill("/fixture/project-23");
  await page.getByRole("button", { name: /Project 23.*project-23/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 1);
  await page.evaluate(() => window.__board.store.getState().selectProject(null));
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("Implement project 5");
  await page.getByRole("button", { name: /Implement project 5/ }).click();
  await pane.waitFor();
  assert.equal(
    await page.getByRole("button", { name: "标记完成", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.evaluate(() => (document.documentElement.className = "theme-zai-dark"));
  await page.screenshot({ path: join(artifacts, "desktop-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "board scroll remains inside the column container",
  );
  await page.getByRole("button", { name: /Remote API session/ }).click();
  await pane.waitFor();
  await page.waitForFunction(
    () => {
      const r = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
      return r && r.width >= 388 && Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && r.height >= 840;
    },
    {},
    { timeout: 3000 },
  );
  const box = await page.getByRole("dialog").boundingBox();
  assert.ok(
    box.width >= 388 && Math.abs(box.x) < 1 && box.height >= 840,
    "mobile drawer covers viewport",
  );
  await page.screenshot({ path: join(artifacts, "mobile-details.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("no-such-session");
  await page.getByRole("status").filter({ hasText: "没有符合条件的会话" }).waitFor();
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索项目名称或路径…", exact: true }).fill("project-23");
  await page.getByRole("button", { name: /Project 23.*project-23/ }).click();
  assert.equal(await page.getByTestId("navigation").textContent(), "new:/fixture/project-23");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real board/hooks; 24 projects; identity routing; API/ACP completion/archive; six-pin limit; search; desktop themes; mobile drawer; new session. Screenshots: " +
      artifacts,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
