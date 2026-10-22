// Real Composer/Lexical and paste/drop events; synthetic filesystem/admission, no model calls.
import assert from "node:assert/strict";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__directory-attachments-${process.pid}`;
const html = join(root, name + ".html");
const moduleFile = join(root, name + ".tsx");
const artifacts = await mkdtemp(join(tmpdir(), "zcode-directory-attachments-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState,useRef,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import '../../../ui/src/styles.css';
const calls=[],pendingStats=[];
let delayStat=false;
const services={
clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
fileService:{searchWorkspaceFiles:async()=>[],stat:async({path})=>{if(delayStat)await new Promise(resolve=>pendingStats.push(resolve));return {path,type:'directory'}}},
pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},
subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
promptAttachmentTransferService:{onDynamicProgress:()=>()=>({dispose(){}}),adopt:async()=>{},cleanup:async()=>{}},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})},
};
const platform={isMacOS:true,isWindows:false,isLinux:false,isWeb:false,getPathForFile:file=>'/synthetic/'+file.name};
const noop=()=>{};
function Fixture(){
const [session,setSession]=useState('A');const [draft,setDraft]=useState({text:'',updatedAt:0});
const dropTarget=useRef(null);
const updateDraft=useCallback(content=>setDraft(current=>({...current,...content,updatedAt:Date.now()})),[]);
const updateDropTarget=useCallback(controller=>{dropTarget.current=controller},[]);
const acp=new URLSearchParams(location.search).has('acp');
window.__directories={calls,pendingStats,switch:setSession,theme:applyTheme,delay:()=>{delayStat=true},release:()=>{delayStat=false;pendingStats.splice(0).forEach(resolve=>resolve())}};
const snapshot={sessionId:session,config:{mode:'build',followupMode:'queue'},inputRouting:{mode:'startNow'},control:{canStop:false,phase:'idle'},rows:{totalCount:0},usage:null,queue:{items:[]},backgroundWorks:[]};
return <main className="h-screen flex items-end p-4 bg-background text-foreground" data-session={session} onDrop={event=>dropTarget.current?.onDrop(event)}>
<ConversationComposer snapshot={snapshot as never} sessionId={session} workspacePath="/synthetic/workspace" attachmentSessionId={session}
composerDraft={draft} updateComposerContent={updateDraft} replaceComposerDraft={setDraft}
acpAgent={acp?'codex':null} acpSessionId={acp?session:null} acpReady acpConfigOptions={[]}
onSendAcpText={async input=>{calls.push({kind:'acp',...input});return session}}
onSendText={async(text,options)=>{calls.push({kind:'api',text,attachments:options.attachments});return 'sent'}}
onDropTargetControllerChange={updateDropTarget}
onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop} autoFocusEnabled={false} listenAddToChatEvents={false}/></main>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const acp of [false, true]) {
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(
        `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html${acp ? "?acp" : ""}`,
      );
      const input = page.getByTestId("v4-composer-input");
      await input.waitFor();
      await page.evaluate(
        (theme) => window.__directories.theme(theme),
        width === 1280 ? "zai-light" : "zai-dark",
      );
      const addDirectory = async (eventType) =>
        page.evaluate((eventType) => {
          const data = new DataTransfer();
          data.items.add(new File([], "project.png", { type: "image/png" }));
          const input = document.querySelector(
            eventType === "paste" ? '[data-testid="v4-composer-input"]' : "main",
          );
          input.dispatchEvent(
            eventType === "paste"
              ? new ClipboardEvent("paste", {
                  clipboardData: data,
                  bubbles: true,
                  cancelable: true,
                })
              : new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
          );
        }, eventType);
      for (const eventType of ["paste", "drop"]) {
        await addDirectory(eventType);
        const chip = page.locator('[data-composer-attachment-kind="directory"]');
        await chip.waitFor({ timeout: 10000 }).catch(async (error) => {
          console.error({
            acp,
            width,
            eventType,
            errors,
            body: await page.locator("body").innerText(),
          });
          throw error;
        });
        assert.match(await chip.innerText(), /project.png/);
        assert.match(await chip.innerText(), /文件夹/);
        assert.doesNotMatch(await chip.innerText(), /OCTET-STREAM|PNG/);
        if (eventType === "paste")
          await page.screenshot({ path: join(artifacts, `${acp ? "acp" : "api"}-${width}.png`) });
        await input.fill("Inspect this directory");
        await page.getByTestId("v4-composer-send").click();
        await page.waitForFunction(
          (count) => window.__directories.calls.length === count,
          eventType === "paste" ? 1 : 2,
        );
        const call = await page.evaluate(() => window.__directories.calls.at(-1));
        assert.equal(call.kind, acp ? "acp" : "api");
        assert.equal(
          acp ? call.attachments[0].path : call.attachments[0].ref,
          "/synthetic/project.png",
        );
        assert.equal(
          acp ? call.attachments[0].mimeType : call.attachments[0].mime,
          "inode/directory",
        );
        await chip.waitFor({ state: "detached" });
      }
      await page.evaluate(() => window.__directories.delay());
      await addDirectory("paste");
      await page.waitForFunction(() => window.__directories.pendingStats.length === 1);
      const item = page.locator("[data-composer-attachment-kind]");
      await item.getByRole("button").last().click();
      await page.evaluate(() => {
        window.__directories.switch("B");
        window.__directories.release();
      });
      await page.locator('main[data-session="B"]').waitFor();
      assert.equal(await page.locator("[data-composer-attachment-kind]").count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    `Directory paste/drop/send E2E passed in API/ACP at 1280/375px. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
