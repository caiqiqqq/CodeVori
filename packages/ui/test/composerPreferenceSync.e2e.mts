// Real Host preference owner and React hooks, two isolated browsers; no Agent or model requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createComposerPreferenceService } from "../../services/src/composer-preference/composerPreferenceService.js";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__composer-preference-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const directory = await mkdtemp(join(tmpdir(), "zcode-preference-e2e-"));
const service = createComposerPreferenceService(directory);
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let writes = 0;
let holdRead = false;
let releaseRead: (() => void) | undefined;
let notifyHeldRead: (() => void) | undefined;
const holdNextRead = () => {
  holdRead = true;
  releaseRead = undefined;
  return new Promise<void>((resolve) => {
    notifyHeldRead = resolve;
  });
};
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {useComposerPreference} from '../../../ui/src/hooks/useComposerPreference.ts';
    import {useDraftConfigControl} from '../../../ui/src/v4/composer/useDraftConfigControl.ts';
    import {clearV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    const scope={workspacePath:'/fixture/sync'};
    const request=async(method,input)=>{const response=await fetch('/__composer-preference'+(method==='GET'?'?scope='+encodeURIComponent(JSON.stringify(input)):''),{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(input)}:{})});if(!response.ok)throw new Error(await response.text());return response.json()};
    const preferenceService={get:input=>request('GET',input),update:input=>request('POST',input),onDynamicChanged:input=>listener=>{
      const events=new EventSource('/__composer-preference-events?scope='+encodeURIComponent(JSON.stringify(input)));
      events.onmessage=event=>listener(JSON.parse(event.data));return {dispose:()=>events.close()};
    }};
    const selection={providerId:'provider',modelId:'one',options:{reasoningLevel:'high'}};
    const models={getView:async input=>({revision:1,preferredSelection:selection,effectiveSelection:input?.selection??selection,providers:[{providerId:'provider',models:['one','two'].map(modelId=>({modelId,config:{optionSpecs:{reasoningLevel:{values:['low','high']}}}}))}]}),onDidChange:()=>({dispose(){}})};
    const services={composerPreferenceService:preferenceService,modelSelectionService:models,settingService:{get:async()=>({})},zcodeSessionService:{}};
    const platform={onSettingsChanged:()=>()=>{}};
    function Draft(){
      const preference=useComposerPreference(scope.workspacePath);
      const [historical,setHistorical]=useState(false);
      const control=useDraftConfigControl({...scope,sessionId:historical?'history':null,sessionConfig:historical?{mode:'build',modelSelection:selection}:null,agentStartupAllowed:false,modelSelectionService:models,preference});
      return <main data-testid='draft' data-model={control.draftConfig.model??''} data-target={preference.snapshot?.target?.kind??''} data-agent={preference.snapshot?.target?.kind==='acp'?preference.snapshot.target.agent:''} data-ready={preference.ready} data-revision={preference.snapshot?.revision??0}>
        <label>模型<select aria-label='模型' value={control.draftConfig.model??''} onChange={event=>control.handleDraftSelectModel('provider',event.target.value)}><option value='one'>One</option><option value='two'>Two</option></select></label>
        <label>草稿<textarea aria-label='草稿' value={control.composerDraft.text} onChange={event=>control.updateComposerContent({text:event.target.value})}/></label>
        <button onClick={()=>preference.select({kind:'acp',agent:'codex'})}>Codex</button>
        <button onClick={()=>setHistorical(true)}>历史会话</button>
        <p role='status'>{preference.error??''}</p>
      </main>;
    }
    function App(){const [epoch,setEpoch]=useState(0);return <><button onClick={()=>{clearV4ComposerDraft(scope.workspacePath,undefined,'__draft__');setEpoch(value=>value+1)}}>新建任务</button><Draft key={epoch}/></>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><App/></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "error",
    plugins: [
      {
        name: "preference-owner-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            if (
              !request.url ||
              !["/__composer-preference", "/__composer-preference-events"].includes(
                request.url.split("?")[0]!,
              )
            )
              return next();
            try {
              const url = new URL(request.url, "http://localhost");
              if (url.pathname.endsWith("-events")) {
                response.writeHead(200, {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                });
                response.write(": ready\n\n");
                const subscription = service.onDynamicChanged(
                  JSON.parse(url.searchParams.get("scope")!),
                )((snapshot) => response.write(`data: ${JSON.stringify(snapshot)}\n\n`));
                request.on("close", () => subscription.dispose());
              } else {
                let body = "";
                for await (const chunk of request) body += chunk;
                if (request.method === "POST") writes++;
                const snapshot =
                  request.method === "POST"
                    ? await service.update(JSON.parse(body))
                    : await service.get(JSON.parse(url.searchParams.get("scope")!));
                if (request.method === "GET" && holdRead) {
                  holdRead = false;
                  await new Promise<void>((resolve) => {
                    releaseRead = resolve;
                    notifyHeldRead?.();
                    notifyHeldRead = undefined;
                  });
                }
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify(snapshot));
              }
            } catch (error) {
              response.statusCode = 500;
              response.end(String(error));
            }
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const pc = await desktopContext.newPage();
  const mobile = await mobileContext.newPage();
  const errors: string[] = [];
  for (const page of [pc, mobile]) page.on("pageerror", (error) => errors.push(error.message));
  const address = server.httpServer!.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/${name}.html`;
  const expectModel = async (page: typeof pc, model: string) => {
    await page
      .waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="draft"]')?.getAttribute("data-model") === expected,
        model,
      )
      .catch(async (cause) => {
        throw new Error(
          `${String(cause)}; errors=${JSON.stringify(errors)}; body=${await page.locator("body").innerText()}`,
        );
      });
  };
  await Promise.all([pc.goto(url), mobile.goto(url)]);
  await expectModel(pc, "one");
  await expectModel(mobile, "one");
  await pc.getByLabel("模型", { exact: true }).selectOption("two");
  await expectModel(mobile, "two");
  assert.equal(writes, 1, "preference broadcasts cannot create a write loop");
  await mobile.reload();
  await expectModel(mobile, "two");
  await mobile.getByLabel("草稿", { exact: true }).fill("keep my unsent draft");
  await pc.getByLabel("模型", { exact: true }).selectOption("one");
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-revision") === "2",
  );
  assert.equal(await mobile.getByLabel("模型", { exact: true }).inputValue(), "two");
  assert.equal(
    await mobile.getByLabel("草稿", { exact: true }).inputValue(),
    "keep my unsent draft",
  );
  await mobile.getByRole("button", { name: "新建任务" }).click();
  await expectModel(mobile, "one");
  await mobile.getByLabel("模型", { exact: true }).selectOption("two");
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-revision") === "3",
  );
  await mobile.reload();
  await expectModel(mobile, "two");
  await pc.getByLabel("模型", { exact: true }).selectOption("one");
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-revision") === "4",
  );
  assert.equal(
    await mobile.getByLabel("模型", { exact: true }).inputValue(),
    "two",
    "explicit choice survives broadcast and reload",
  );
  await mobile.getByRole("button", { name: "历史会话" }).click();
  await expectModel(mobile, "one");
  await pc.getByLabel("模型", { exact: true }).selectOption("two");
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-revision") === "5",
  );
  assert.equal(
    await mobile.getByLabel("模型", { exact: true }).inputValue(),
    "one",
    "history keeps its session selection",
  );
  await pc.getByRole("button", { name: "Codex", exact: true }).click();
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-agent") === "codex",
  );
  await mobile.reload();
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-agent") === "codex",
  );
  assert.equal(writes, 6);
  await mobile.getByRole("button", { name: "新建任务" }).click();
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-ready") === "true",
  );
  const heldReconnectRead = holdNextRead();
  await mobile.reload();
  await heldReconnectRead;
  await pc.getByLabel("模型", { exact: true }).selectOption("one");
  await expectModel(mobile, "one");
  assert.ok(releaseRead, "reconnect read must be held while the newer event arrives");
  releaseRead();
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-ready") === "true",
  );
  assert.equal(
    await mobile.getByLabel("模型", { exact: true }).inputValue(),
    "one",
    "late reconnect snapshot cannot overwrite newer preference events",
  );
  assert.equal(writes, 7);
  const heldInitializationRead = holdNextRead();
  await mobile.reload();
  await heldInitializationRead;
  await mobile.getByLabel("模型", { exact: true }).selectOption("two");
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="draft"]')?.getAttribute("data-revision") === "8",
  );
  releaseRead!();
  await expectModel(mobile, "two");
  await mobile.reload();
  await expectModel(mobile, "two");
  assert.equal(
    writes,
    8,
    "explicit selection before preference hydration is preserved without automatic writeback",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: independent desktop/mobile clients, API and ACP preference sync, reconnect with stale snapshots, new tasks, edited drafts, explicit choices, history and no broadcast loops.",
  );
  await Promise.all([desktopContext.close(), mobileContext.close()]);
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(directory, { recursive: true, force: true }),
  ]);
}
