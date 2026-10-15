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
    import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import '../../../ui/src/styles.css';
    const scopes={source:{workspacePath:'/synthetic/source'},target:{workspacePath:'/synthetic/target'},hostA:{workspacePath:'/synthetic/shared',workspaceIdentity:'synthetic-host-A'},hostB:{workspacePath:'/synthetic/shared',workspaceIdentity:'synthetic-host-B'}};
    const key=scope=>scope.workspaceIdentity?.trim()||scope.workspacePath;
    const sharedId=crypto.randomUUID();
    const snapshots=new Map(Object.entries(scopes).map(([label,scope])=>[key(scope),{...scope,id:label.startsWith('host')?sharedId:crypto.randomUUID(),agent:'codex',acpSessionId:'native-'+label,title:'history-'+label,revision:1,status:'idle',entries:[{id:'user:'+label,kind:'user',text:'history-content-'+label}],configOptions:[],modeState:null,contextUsage:null,usageTurns:[],goal:null,pendingPermission:null,error:null,queue:{items:[],autoDrain:true}}]));
    const calls=[],held=new Map(),delays=new Set(),listeners=new Set();
    const copy=scope=>structuredClone(snapshots.get(key(scope)));
    const wait=async(op,scope)=>{calls.push([op,key(scope),scope.remoteSessionId]);if(delays.delete(op+':'+key(scope)))await new Promise(resolve=>held.set(op+':'+key(scope),resolve))};
    const forbidden=()=>{throw Error('Unexpected native/model operation')};
    const acpService={list:async scope=>{await wait('list',scope);return [copy(scope)]},read:async scope=>copy(scope),refresh:async scope=>{await wait('refresh',scope);return copy(scope)},
      onDynamicSessionChanged:scope=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
      listAvailableAgents:async()=>[{agent:'codex',available:true}],listAgentConfigs:async()=>[],listPlugins:async()=>[],onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),
      create:async scope=>{calls.push(['create',key(scope)]);throw Error('History selection must never create a draft')},remove:async()=>{},submitPrompt:forbidden};
    const services={acpService,settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},clientScenesService:{list:async()=>({code:0,data:[]})},subagentsService:{list:async()=>({agents:[],capability:null})},modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})}};
    const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
    function Fixture(){
      const initial=new URLSearchParams(location.search).get('initial')||'source';
      const [label,setLabel]=useState(initial),[request,setRequest]=useState(null),[attachment,setAttachment]=useState(1);
      const scope=scopes[label];
      window.__first={calls,held,open:next=>{setLabel(next);setRequest(previous=>({requestId:(previous?.requestId??0)+1,session:copy(scopes[next])}))},reconnect:()=>setAttachment(n=>n+1),hold:(op,next)=>delays.add(op+':'+key(scopes[next])),release:(op,next)=>{const id=op+':'+key(scopes[next]);held.get(id)?.();held.delete(id)},newDraft:()=>{setRequest(null);useZCodeSessionStore.getState().startDraft(scope.workspacePath,undefined,scope.workspaceIdentity)}};
      return <main className='h-dvh bg-background text-foreground'><SessionPane paneId='workspace-main' {...scope} remoteSessionId={new URLSearchParams(location.search).has('replayable')?'attachment-'+attachment:undefined} sessionId={null} focused acpOpenRequest={request}/></main>;
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
    await open("target");
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
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS: real SessionPane first cross-workspace open, same-workspace open, identity isolation, stale refresh, new draft and replayable reconnect. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
