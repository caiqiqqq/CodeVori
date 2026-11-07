// Real SessionPane/hook with scoped synthetic Host snapshots; no Agent or model requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__acp-first-selection-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-first-selection-"));
let server, browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
    import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider,withAcpProjectionFixture} from '../../../ui/test/acpProjectionFixture.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import '../../../ui/src/styles.css';
    const scopes={source:{workspacePath:'/synthetic/source'},target:{workspacePath:'/synthetic/target'},hostA:{workspacePath:'/synthetic/shared',workspaceIdentity:'synthetic-host-A'},hostB:{workspacePath:'/synthetic/shared',workspaceIdentity:'synthetic-host-B'}};
    const key=scope=>scope.workspaceIdentity?.trim()||scope.workspacePath;
    const sharedId=crypto.randomUUID();
    const snapshots=new Map(Object.entries(scopes).map(([label,scope])=>[key(scope),{...scope,id:label.startsWith('host')?sharedId:crypto.randomUUID(),agent:'codex',acpSessionId:'native-'+label,title:'history-'+label,revision:1,status:'idle',entries:[{id:'user:'+label,kind:'user',text:'history-content-'+label}],configOptions:[],modeState:null,contextUsage:null,usageTurns:[],goal:null,pendingPermission:null,error:null,queue:{items:[],autoDrain:true}}]));
    const calls=[],archived=[],held=new Map(),delays=new Set(),listeners=new Set(),preferenceListeners=new Set();
    const preference={revision:1,acpModels:{}};
    const preconnect=new URLSearchParams(location.search).has('preconnect'),drafts=new Map();
    const copy=scope=>structuredClone(drafts.get(scope.id)??snapshots.get(key(scope)));
    const wait=async(op,scope)=>{calls.push([op,key(scope),scope.remoteSessionId]);if(delays.delete(op+':'+key(scope)))await new Promise(resolve=>held.set(op+':'+key(scope),resolve))};
    const forbidden=()=>{throw Error('Unexpected native/model operation')};
    const acpService={list:async scope=>{await wait('list',scope);return [copy(scope)]},read:async scope=>copy(scope),refresh:async scope=>{await wait('refresh',scope);return copy(scope)},
      onDynamicSessionChanged:scope=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
      listAvailableAgents:async()=>[{agent:'codex',available:true}],listAgentConfigs:async()=>[],listPlugins:async()=>[],onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),
      create:async scope=>{await wait('create',scope);if(!preconnect)throw Error('Authentication required');
        const draft={...copy(scope),remoteSessionId:scope.remoteSessionId,id:crypto.randomUUID(),revision:0,provisional:true,entries:[],
          configOptions:[{id:'mode',name:'Mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'}]}]};
        drafts.set(draft.id,draft);return structuredClone(draft)},remove:async({id})=>{drafts.delete(id)},
      submitPrompt:async input=>{if(!preconnect) return forbidden();calls.push(['prompt',key(input),input.id]);
        const session={...copy(input),provisional:false,revision:1,entries:[{id:'user:'+input.commandId,kind:'user',text:input.text}]};
        drafts.set(session.id,session);for(const listener of listeners)listener({kind:'updated',session});return structuredClone(session)}};
    withAcpProjectionFixture(acpService as never);
    const readConversation=acpService.readConversation;
    acpService.readConversation=async input=>{await wait('conversation',input);return readConversation(input)};
    const composerPreferenceService={get:async()=>({...preference}),onDynamicChanged:()=>listener=>{preferenceListeners.add(listener);return {dispose:()=>preferenceListeners.delete(listener)}},update:async()=>({...preference})};
    const services={acpService,composerPreferenceService,settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},clientScenesService:{list:async()=>({code:0,data:[]})},subagentsService:{list:async()=>({agents:[],capability:null})},modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})}};
    const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
    function Fixture(){
      const initial=new URLSearchParams(location.search).get('initial')||'source';
      const [label,setLabel]=useState(initial),[request,setRequest]=useState(null),[attachment,setAttachment]=useState(1),[paneEpoch,setPaneEpoch]=useState(0),[suppressPreference,setSuppressPreference]=useState(false);
      const scope=scopes[label];
      window.__first={calls,held,archived,preference,open:next=>{setLabel(next);setRequest(previous=>({requestId:(previous?.requestId??0)+1,session:copy(scopes[next])}))},reconnect:()=>setAttachment(n=>n+1),hold:(op,next)=>delays.add(op+':'+key(scopes[next])),release:(op,next)=>{const id=op+':'+key(scopes[next]);held.get(id)?.();held.delete(id)},newDraft:()=>{setSuppressPreference(false);setRequest(null);useZCodeSessionStore.getState().startDraft(scope.workspacePath,undefined,scope.workspaceIdentity)},preferAcp:()=>{preference.target={kind:'acp',agent:'codex'};preference.revision++;for(const listener of preferenceListeners)listener({...preference})},archive:next=>{const session=snapshots.get(key(scopes[next]));const nextSession={...session,archived:true,revision:session.revision+1};snapshots.set(key(scopes[next]),nextSession);for(const listener of listeners)listener({kind:'updated',session:nextSession})}};
      return <main className='h-dvh bg-background text-foreground'><SessionPane key={paneEpoch} paneId='workspace-main' {...scope} remoteSessionId={new URLSearchParams(location.search).has('replayable')?'attachment-'+attachment:undefined} sessionId={null} focused draftComposerHeader={<span>synthetic project</span>} acpOpenRequest={request} suppressAcpPreferenceForDraft={suppressPreference} onAcpSessionArchived={id=>{archived.push(id);setSuppressPreference(true);setRequest(null);setPaneEpoch(value=>value+1)}}/></main>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true} as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><V4ConversationContext.Provider value={native as never}><Fixture/></V4ConversationContext.Provider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "error",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 394]) {
    const page = await browser.newPage({ viewport: { width, height: 852 }, hasTouch: width < 768 });
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.httpServer.address().port}/${name}.html?${width < 768 ? "replayable&" : ""}`;
    const open = (label) => page.evaluate((label) => window.__first.open(label), label);
    const history = (label) =>
      page.getByTestId("v4-timeline").getByText(`history-content-${label}`, { exact: true });
    const count = (op, scope) =>
      page.evaluate(
        ({ op, scope }) =>
          window.__first.calls.filter((call) => call[0] === op && (!scope || call[1] === scope))
            .length,
        { op, scope },
      );
    await page.goto(url);
    await page.getByTestId("v4-composer-input").waitFor();
    // Previously the delayed ACP activation erased this first cross-workspace selection.
    await page.evaluate(() => window.__first.hold("conversation", "target"));
    await open("target");
    await page.waitForFunction(() => window.__first.held.has("conversation:/synthetic/target"));
    await page.getByRole("status").filter({ hasText: "正在读取会话历史…" }).waitFor();
    assert.equal(await history("source").count(), 0);
    await page.evaluate(() => window.__first.release("conversation", "target"));
    await history("target").waitFor();
    await page.waitForFunction(() => window.__first.calls.some((call) => call[0] === "refresh"));
    assert.equal(await count("create"), 0);
    await page.screenshot({ path: join(artifacts, `cross-first-${width}.png`) });
    await open("source");
    await history("source").waitFor();
    assert.equal(await history("target").count(), 0);
    // A list from the previous workspace may arrive after the next history is visible.
    await page.evaluate(() => window.__first.hold("list", "target"));
    await open("target");
    await page.waitForFunction(() => window.__first.held.has("list:/synthetic/target"));
    await open("source");
    await history("source").waitFor();
    await page.evaluate(() => window.__first.release("list", "target"));
    await history("source").waitFor();
    assert.equal(await history("target").count(), 0);
    // Old refresh responses cannot replace a later workspace selection.
    await page.evaluate(() => window.__first.hold("refresh", "target"));
    await open("target");
    await page.waitForFunction(() => window.__first.held.has("refresh:/synthetic/target"));
    await open("source");
    await history("source").waitFor();
    await page.evaluate(() => window.__first.release("refresh", "target"));
    await history("source").waitFor();
    assert.equal(await history("target").count(), 0);
    // Identical paths and session ids under different identities remain isolated.
    await open("hostA");
    await history("hostA").waitFor();
    await open("hostB");
    await history("hostB").waitFor();
    assert.equal(await history("hostA").count(), 0);
    if (width < 768) {
      await page.evaluate(() => window.__first.reconnect());
      await page.waitForFunction(() =>
        window.__first.calls.some((call) => call[0] === "list" && call[2] === "attachment-2"),
      );
      await history("hostB").waitFor();
    }
    assert.equal(await count("create"), 0);
    await page.evaluate(() => window.__first.newDraft());
    await history("hostB").waitFor({ state: "detached" });
    await page.goto(url + "initial=target");
    await page.getByTestId("v4-composer-input").waitFor();
    await open("target");
    await history("target").waitFor();
    assert.equal(await count("create"), 0, "Same-workspace first open must also preserve history");
    await page.goto(url + "initial=hostA");
    await page.getByTestId("v4-composer-input").waitFor();
    await open("hostB");
    await history("hostB").waitFor();
    assert.equal(
      await count("create"),
      0,
      "First open under a different identity must preserve history",
    );
    await open("target");
    await history("target").waitFor();
    await page.evaluate(() => window.__first.preferAcp());
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__first.archive("target"));
    await page.waitForTimeout(200);
    assert.ok((await page.evaluate(() => window.__first.archived.length)) > 0);
    await history("target").waitFor({ state: "detached" });
    await page.waitForTimeout(100);
    assert.equal(await count("create"), 0, "Archive must not preconnect the preferred ACP agent");
    assert.equal(await page.evaluate(() => window.__first.preference.target.agent), "codex");
    await page.evaluate(() => window.__first.newDraft());
    await page.waitForFunction(() => window.__first.calls.some((call) => call[0] === "create"));
    await page.getByText("Authentication required", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    // 修复依据：临时预连接也会取得精确 ID，但没有接受用户输入，不能因此退出首页。
    await page.goto(url + "preconnect");
    const input = page.getByTestId("v4-composer-input");
    const greeting = page.locator('[data-v4-draft-greeting="true"]');
    const contextHeader = page.locator('[data-v4-composer-context-header="true"]');
    const centeredComposer = page.getByTestId("v4-composer").and(page.locator(".max-w-2xl"));
    await input.waitFor();
    await page.evaluate(() => {
      window.__preconnectInput = document.querySelector('[data-testid="v4-composer-input"]');
      window.__first.hold("create", "source");
      window.__first.preferAcp();
    });
    await page.waitForFunction(() => window.__first.held.has("create:/synthetic/source"));
    await greeting.waitFor();
    assert.equal(await contextHeader.count(), 1);
    assert.equal(await centeredComposer.count(), 1);
    await page.screenshot({ path: join(artifacts, `preconnect-pending-${width}.png`) });
    await page.evaluate(() => window.__first.release("create", "source"));
    await page.locator('[data-testid="acp-config-trigger-mode"]:enabled').waitFor();
    await page.waitForFunction(() =>
      window.__first.calls.some((call) => call[0] === "conversation"),
    );
    assert.equal(await greeting.isVisible(), true, "Preconnect must keep the home greeting");
    assert.equal(await contextHeader.count(), 1, "Preconnect must keep the project header");
    assert.equal(await centeredComposer.count(), 1, "Preconnect must keep the centered composer");
    assert.equal(await count("prompt"), 0, "Preconnect must not submit a prompt");
    assert.equal(
      await page.evaluate(
        () =>
          window.__preconnectInput === document.querySelector('[data-testid="v4-composer-input"]'),
      ),
      true,
    );
    await page.screenshot({ path: join(artifacts, `preconnect-ready-${width}.png`) });
    await input.fill("first accepted draft input");
    await page.getByTestId("v4-composer-send").click();
    await page
      .locator("[data-v4-user-input-bubble]")
      .filter({ hasText: "first accepted draft input" })
      .waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
    );
    assert.equal(await greeting.count(), 0);
    assert.equal(await contextHeader.count(), 0);
    assert.equal(await centeredComposer.count(), 0);
    assert.equal(await count("create"), 1, "First input reuses the preconnected session");
    assert.equal(await count("prompt"), 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS: real SessionPane selection, archive/auth, empty preconnect home, first input, and replayable reconnect. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
