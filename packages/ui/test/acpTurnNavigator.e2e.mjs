// Desktop Vite renderer + real SessionPane/Timeline; fake Host, no user history or model calls.
// ZCODE_E2E_VITE_URL=http://localhost:5174 node packages/ui/test/acpTurnNavigator.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { exerciseAcpAttachmentLatency } from "./acpAttachmentLatencyAssertions.mjs";
import { createAcpAttachmentLayoutAssertions } from "./acpAttachmentLayoutAssertions.mjs";
import { createTurnNavigatorAssertions } from "./conversationTurnNavigatorAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-turn-navigator-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "codevori-turn-navigator-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
      import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
      import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';

      const workspacePath = '/fixture/turn-navigator';
      const listeners = new Set();
      const sessions = new Map();
      const files = new Map();
      const reads = [];
      let delayReads=false; const pendingReads=[];
      function png(color) {
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=32;
        const context=canvas.getContext('2d'); context.fillStyle=color; context.fillRect(0,0,32,32);
        return Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),char=>char.charCodeAt(0));
      }
      const red=png('#ff0000'), blue=png('#0000ff');
      function saveFixtureAttachment(id,bytes,mime,fileName,index,acp=true) {
        const ref=(acp?'acp-attachment:':'native-fixture:')+crypto.randomUUID()+'/'+index;
        files.set(ref,{id,bytes,mime}); return {ref,fileName,mime,bytes:bytes.length};
      }
      function attachmentFixtures(id,acp=true) {
        return [saveFixtureAttachment(id,red,'image/png','same.png',0,acp),
          saveFixtureAttachment(id,blue,'image/png','same.png',1,acp),
          saveFixtureAttachment(id,new TextEncoder().encode('notes'),'text/plain','notes.txt',2,acp)];
      }
      const unexpected = [];
      const forbidden = () => {unexpected.push('command'); throw new Error('Navigation must not send a command')};
      const disposable = () => ({dispose(){}});
      const native = {
        layer: {acquire: forbidden}, sendCommand: forbidden,
        attachmentPut: forbidden, attachmentRead: forbidden, attachmentReadRange: forbidden,
        fileChanges: forbidden, fileRewindPreview: forbidden, workflowRuns: forbidden,
        onRuntimeRestart: () => () => {}, onRuntimeLifecycle: () => () => {},
      };
      const services = {
        settingService: {get: async () => ({})},
        modelSelectionService: {getView: async () => ({revision:1,providers:[]}), onDidChange:disposable},
        acpService: {
          onDynamicSessionChanged: () => listener => {
            listeners.add(listener); return {dispose:()=>listeners.delete(listener)};
          },
          list: async () => [...sessions.values()],
          refresh: async ({id}) => sessions.get(id),
          readAttachment: async ({id,ref,offset=0,limit=131072,workspacePath:path}) => {
            reads.push({id,ref});
            if(delayReads) await new Promise(resolve=>pendingReads.push(resolve));
            const file=files.get(ref);
            if(path!==workspacePath || !file || file.id!==id || file.failed) throw new Error('Fixture attachment unavailable');
            const end=Math.min(file.bytes.length,offset+limit);
            return {dataBase64:btoa(String.fromCharCode(...file.bytes.slice(offset,end))),
              mediaType:file.mime,totalBytes:file.bytes.length,nextOffset:end<file.bytes.length?end:null};
          },
          create: forbidden, prompt: forbidden, authenticate: forbidden,
        },
      };
      let revision = 0;
      function makeSession(agent, count, dated=true,withAttachments=true,compact=false) {
        ++revision;
        const id = crypto.randomUUID();
        const attachments=withAttachments?attachmentFixtures(id):undefined;
        const entries = Array.from({length:count}, (_,index) => [
          {id:'user:'+agent+'-'+index,kind:'user',text:agent+' question '+index,
            ...(index===0?(attachments?{attachments,attachmentNames:['same.png','same.png','notes.txt']}:{attachmentNames:['legacy.png']}):{}),
            ...(index===1&&attachments?{attachments:[attachments[1]],attachmentNames:['same.png']}:{}),
            ...(dated?{createdAt:1700000000000+index}: {})},
          {id:'assistant:'+agent+'-'+index,kind:'assistant',text:agent+' answer '+index+'\\n\\n'+('Long conversation content. '.repeat(compact?3:30)),...(dated?{createdAt:1700000000000+index}: {})},
        ]).flat();
        const session = {id,agent,workspacePath,title:agent+' conversation',revision:1,
          status:'idle',entries,acpSessionId:null,usageTurns:[],nativeUsage:null,provisional:false,configOptions:[],modeState:null,createdAt:1,updatedAt:1};
        sessions.set(id,session); return session;
      }
      const firstSession = makeSession('codex',24);
      const controls = {unexpected,reads,pendingReads,
        delayReads:()=>{delayReads=true},
        releaseReads:()=>{delayReads=false;for(const resolve of pendingReads.splice(0))resolve()}};
      window.__turnNavigator = controls;
      const apiRows = Array.from({length:8}, (_,index) => [
        {kind:'turnHeader',rowId:index*3+1,turnId:'api:'+index,createdAt:1,createdAtSeq:index,
          origin:'userInput',executionKind:'agent',state:'completedSuccess',startedAt:1},
        {kind:'userInput',rowId:index*3+2,turnId:'api:'+index,createdAt:1,createdAtSeq:index,
          origin:'realUser',text:'API question '+index,...(index===0?{attachments:attachmentFixtures('api-fixture',false)}:{})},
        {kind:'assistantText',rowId:index*3+3,turnId:'api:'+index,createdAt:1,createdAtSeq:index,
          state:'complete',text:'API answer '+index+'\\n\\n'+('Native conversation content. '.repeat(5))},
      ]).flat();
      function Fixture() {
        const [request,setRequest] = useState({requestId:1,session:firstSession});
        const [view,setView] = useState({api:false,share:false});
        controls.open = (agent,count,dated=true,withAttachments=true,compact=false) => {
          setView({api:false,share:false});
          const session=makeSession(agent,count,dated,withAttachments,compact);
          for(const listener of listeners) listener({kind:'updated',session});
          setRequest({requestId:revision,session});
        };
        controls.reopen = () => {
          setView({api:false,share:false});
          setRequest({requestId:++revision,session:sessions.get(firstSession.id)});
        };
        controls.failed = () => {
          const session=makeSession('claude',1);
          for(const attachment of session.entries[0].attachments) files.get(attachment.ref).failed=true;
          for(const listener of listeners) listener({kind:'updated',session});
          setView({api:false,share:false}); setRequest({requestId:revision,session});
        };
        controls.append = () => {
          const previous=sessions.get(request.session.id);
          const session={...previous,revision:previous.revision+1,status:'running',entries:[...previous.entries,
            {id:'user:live:'+previous.entries.length,kind:'user',text:previous.agent+' live question'}]};
          sessions.set(session.id,session);
          for(const listener of listeners) listener({kind:'updated',session});
        };
        controls.snapshot = (status, replace=false) => {
          const session=structuredClone(sessions.get(request.session.id));
          session.revision++; session.status=status;
          session.entries.at(-1).text += ".";
          if(replace) session.entries[0].attachments[0]=saveFixtureAttachment(session.id,blue,'image/png','same.png',0);
          sessions.set(session.id,session);
          for(const listener of listeners) listener({kind:'updated',session});
        };
        controls.view = setView;
        return <main className="bg-background text-foreground" style={{width:'calc(100vw - 32px)',height:'calc(100vh - 160px)',margin:16}}>
          {view.api ? <div className="@container/conversation flex h-full min-h-0">
            <ConversationTimeline rows={apiRows as never} totalCount={apiRows.length} sessionKey="api-fixture"
              hideTurnNavigator={view.share} rowContext={{workspacePath,theme:'zai-light',
                sessionId:'api-fixture',readAttachment:async({ref})=>{
                  const file=files.get(ref);
                  if(file.id!=='api-fixture') throw new Error('Wrong API attachment');
                  return {bytes:file.bytes,mediaType:file.mime};
                },
                codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'api-fixture'}}/>
          </div> : <SessionPane paneId="navigator-fixture" workspacePath={workspacePath} sessionId={null}
            readOnly acpBoundSessionId={request.session.id} acpOpenRequest={request as never}/>}
        </main>;
      }
      createRoot(document.getElementById('root')!).render(
        <PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false} as never}>
          <TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN">
            <TooltipProvider><V4ConversationContext.Provider value={native as never}><Fixture/>
            </V4ConversationContext.Provider></TooltipProvider>
          </ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
        </PlatformProvider>
      );
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto(`${origin}/${name}.html`, { timeout: 60000 });
  const rail = page.getByTestId("v4-turn-navigator");
  const timeline = page.getByTestId("v4-timeline");
  const tooltip = page.locator('[data-testid^="v4-turn-navigator-tooltip-"]');
  const query = (index) => rail.locator(`[data-item-index="${index}"]`);
  const { activeQuery, toBottom, visibleQueries, directory } = createTurnNavigatorAssertions(
    page,
    errors,
  );
  const pixel = async (image) => {
    await image.waitFor();
    await image.evaluate((element) => element.decode());
    return image.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.drawImage(element, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
  };
  const attachmentLayout = createAcpAttachmentLayoutAssertions(page, timeline, pixel);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="v4-timeline"]')?.getAttribute("data-row-count") ===
      "72",
  );
  await directory(24);
  await activeQuery(23);
  // Earlier turns start outside the timeline's virtualized window.
  assert.equal(await timeline.locator('[data-row-id="2"]').count(), 0);
  await query(0).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /codex question 0.*codex answer 0/s);
  await query(0).click();
  await page.waitForFunction(() => {
    const scroll = document.querySelector('[data-testid="v4-timeline"]');
    const row = scroll?.querySelector('[data-row-id="2"]');
    return (
      row && Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 3
    );
  });
  assert.equal(await query(0).getAttribute("data-active"), "true");
  const acpLayout = await attachmentLayout("codex question 0");
  const firstMedia = timeline.locator('[data-row-id="2"] [data-v4-user-input-media-attachment]');
  await firstMedia.nth(0).click();
  const gallery = page.getByRole("dialog");
  await gallery.waitFor();
  assert.deepEqual(await pixel(gallery.locator("img")), [255, 0, 0, 255]);
  await gallery.getByRole("button", { name: "下一张图片" }).click();
  assert.deepEqual(await pixel(gallery.locator("img")), [0, 0, 255, 255]);
  await gallery.getByRole("button", { name: "关闭", exact: true }).click();
  await gallery.waitFor({ state: "detached" });
  await page.screenshot({ path: join(artifacts, "codex-navigator.png") });

  await page.evaluate(() => window.__turnNavigator.append());
  await directory(25);
  await activeQuery(0);
  assert.equal(await query(24).getAttribute("data-running"), "true");
  await page.evaluate(() => window.__turnNavigator.open("claude", 3, false, false));
  await directory(3);
  await query(0).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /claude question 0/);
  assert.doesNotMatch(await tooltip.innerText(), /codex/);
  await query(0).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-row-id="2"] [data-v4-user-input-bubble]')
      ?.textContent.includes("legacy.png"),
  );
  assert.equal(
    await timeline.locator('[data-row-id="2"] [data-v4-user-input-media-attachment]').count(),
    0,
  );
  await page.evaluate(() => window.__turnNavigator.reopen());
  await directory(25);
  await activeQuery(24);
  await query(0).click();
  assert.deepEqual(await attachmentLayout("codex question 0"), acpLayout);

  // 截图对应的多轮同屏情形：贴底选最后一条，上滚恢复阅读位置，回来再次选最后一条。
  await page.evaluate(() => window.__turnNavigator.open("codex", 8, true, false, true));
  await directory(8);
  await activeQuery(7);
  assert.ok((await visibleQueries()) >= 2);
  await query(0).click();
  await activeQuery(0);
  await toBottom();
  await activeQuery(7);
  await page.evaluate(() => window.__turnNavigator.append());
  await directory(9);
  await activeQuery(8);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.evaluate(() => window.__turnNavigator.open("codex", 2, true, false, true));
  await directory(2);
  await activeQuery(1);
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="v4-timeline"]');
    return element.scrollHeight <= element.clientHeight;
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  // 长目录本身也需要滚到最后；最新 query 不应停留在 rail 的上方窗口。
  await page.evaluate(() => window.__turnNavigator.open("codex", 96, true, false, true));
  await directory(96);
  await activeQuery(95);
  assert.equal(await rail.evaluate((element) => element.firstElementChild.scrollTop > 0), true);
  await page.screenshot({ path: join(artifacts, "navigator-bottom-long-directory.png") });
  await page.evaluate(() => window.__turnNavigator.reopen());
  await directory(25);

  await page.setViewportSize({ width: 850, height: 800 });
  await rail.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 375, height: 800 });
  assert.equal(await rail.isVisible(), false);
  await page.evaluate(() => window.__turnNavigator.open("codex", 1));
  await attachmentLayout("codex question 0");
  await timeline.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForFunction(() => {
    const timeline = document.querySelector('[data-testid="v4-timeline"]');
    const row = timeline?.querySelector('[data-row-id="2"]');
    return row && row.getBoundingClientRect().top >= timeline.getBoundingClientRect().top - 2;
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: join(artifacts, "acp-attachments-mobile.png") });
  await page.evaluate(() => window.__turnNavigator.reopen());
  await page.setViewportSize({ width: 1280, height: 800 });
  await rail.waitFor({ state: "visible" });
  await page.evaluate(() => window.__turnNavigator.open("codex", 1));
  await rail.waitFor({ state: "detached" });
  await exerciseAcpAttachmentLatency(page, timeline, pixel, attachmentLayout);
  await page.evaluate(() => window.__turnNavigator.failed());
  const unavailable = timeline.locator(
    '[data-row-id="2"] [data-v4-user-input-media-attachment][title="这张图片已无法预览。"]',
  );
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-row-id="2"] [data-v4-user-input-media-attachment][title="这张图片已无法预览。"]',
        ).length === 2,
    )
    .catch(async (error) => {
      await page.screenshot({ path: join(artifacts, "unavailable-diagnostic.png") });
      const state = await page.evaluate(() => ({
        bubble: document.querySelector('[data-row-id="2"] [data-v4-user-input-bubble]')
          ?.textContent,
        titles: [
          ...document.querySelectorAll('[data-row-id="2"] [data-v4-user-input-media-attachment]'),
        ].map((element) => element.getAttribute("title")),
        reads: window.__turnNavigator.reads.slice(-6),
      }));
      throw new Error(
        error.message + "; fixture=" + JSON.stringify(state) + "; errors=" + errors.join("; "),
      );
    });
  assert.equal(await unavailable.first().getAttribute("role"), null);
  assert.equal(
    await timeline.locator('[data-row-id="2"] [data-v4-user-input-bubble]').innerText(),
    "claude question 0",
  );

  await page.evaluate(() => window.__turnNavigator.view({ api: true, share: false }));
  await directory(8);
  await activeQuery(7);
  assert.ok((await visibleQueries()) >= 2);
  await query(0).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /API question 0/);
  await query(0).click();
  assert.deepEqual(await attachmentLayout("API question 0"), acpLayout);
  await activeQuery(0);
  await toBottom();
  await activeQuery(7);
  await page.screenshot({ path: join(artifacts, "api-attachments.png") });
  await page.evaluate(() => window.__turnNavigator.view({ api: true, share: true }));
  await rail.waitFor({ state: "detached" });
  await page.evaluate(() => window.__turnNavigator.view({ api: true, share: false }));
  await directory(8);
  assert.deepEqual(await page.evaluate(() => window.__turnNavigator.unexpected), []);
  assert.ok((await page.evaluate(() => window.__turnNavigator.reads)).length > 0);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: ACP navigator and attachments, gallery, same-name images, session reopen, legacy/unavailable files, mobile layout, API/share regression. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
