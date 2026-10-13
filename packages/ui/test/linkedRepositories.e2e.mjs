// Real Composer, control, hook and draft storage; synthetic Git/Agent admission only.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__linked-projects-${process.pid}`;
const html = join(root, name + ".html");
const moduleFile = join(root, name + ".tsx");
const artifacts = process.env.ZCODE_E2E_ARTIFACTS ?? "/tmp/zcode-linked-projects-preview";
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {persistV4ComposerDraft,readV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import '../../../ui/src/styles.css';
const state:any={calls:[],sent:[],fail:false,delay:false,pending:[],trees:{}};
window.__linked=state;
state.theme=applyTheme;
const info=(path:string)=>state.trees[path]?{kind:'linked-worktree',repoRoot:path,mainWorktreePath:'/projects/backend'}:{kind:path.includes('missing')?'not-repository':'main-tree',repoRoot:path.includes('missing')?null:path};
const services:any={
gitService:{getWorkspaceRepositoryInfo:async r=>info(r.workspacePath),getLocalBranches:async r=>({currentBranchName:state.trees[r.workspacePath]?.branch??'main',branches:[{name:'main'},{name:'test'}]}),resolveLocalBranch:async r=>({commitHash:'commit-'+r.branchName}),createAutomaticWorktree:async r=>{state.calls.push(r);if(state.fail)throw Error('synthetic Git failure');const result={ok:true,worktreePath:'/worktrees/'+state.calls.length+'/backend',branchName:'worktree/'+state.calls.length};const finish=()=>{state.trees[result.worktreePath]={branch:result.branchName};return result};return state.delay?await new Promise(resolve=>state.pending.push(()=>resolve(finish()))):finish()}},
settingService:{get:async()=>({worktreeRootDirectory:'/worktrees'})},systemService:{info:async()=>({homedir:'/home/test'})},
clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},fileService:{searchWorkspaceFiles:async()=>[]},
pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
promptAttachmentTransferService:{onDynamicProgress:()=>()=>({dispose(){}}),adopt:async()=>{},cleanup:async()=>{}},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})},
};
function Fixture(){
const [target,setTarget]=useState('A');
const [drafts,setDrafts]=useState({});
const scope=target==='ACP'?'acp:preview':target;
const draft=drafts[scope]??readV4ComposerDraft('/projects/frontend',undefined,scope)??{text:'',updatedAt:0};
const replace=useCallback(content=>{persistV4ComposerDraft('/projects/frontend',undefined,scope,content);setDrafts(current=>({...current,[scope]:content}))},[scope]);
const update=useCallback(content=>setDrafts(current=>{const next={...(current[scope]??readV4ComposerDraft('/projects/frontend',undefined,scope)??{}),...content,updatedAt:Date.now()};persistV4ComposerDraft('/projects/frontend',undefined,scope,next);return {...current,[scope]:next}}),[scope]);
state.switch=setTarget;state.draft=draft;state.target=target;state.read=scope=>readV4ComposerDraft('/projects/frontend',undefined,scope);
const noop=()=>{};
const snapshot={sessionId:target,config:{mode:'build',followupMode:'queue'},inputRouting:{mode:'startNow'},control:{canStop:false,phase:'idle'},rows:{totalCount:0},usage:null,queue:{items:[]},backgroundWorks:[]};
return <main className="h-screen flex flex-col justify-end bg-background text-foreground p-4"><div className="mx-auto w-full max-w-3xl space-y-4"><div className="text-ui-base text-foreground-subtle">前后端联调 · 关联项目预览</div><ConversationComposer snapshot={snapshot as never} sessionId={target==='ACP'?null:target} composerScopeId={scope}
composerDraft={draft} updateComposerContent={update} replaceComposerDraft={replace} workspacePath="/projects/frontend" attachmentSessionId={target}
acpAgent={target==='ACP'?'codex':null} acpReady={true} acpRunning={false} acpSessionId={target==='ACP'?'preview':null}
onSendAcpText={async input=>{state.sent.push({kind:'acp',target,...input});return 'preview'}}
onSendText={async text=>{state.sent.push({kind:'api',target,text});return 'sent'}} onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop} autoFocusEnabled={false} listenAddToChatEvents={false}/></div></main>;
}
const platform:any={isMacOS:false,isWindows:false,isLinux:true,isWeb:false,selectDirectory:async()=>'/projects/backend'};
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ZCODE_CHROME_PATH,
  });
  for (const width of [1280, 375])
    for (const theme of ["zai-light", "zai-dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(15000);
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
      const input = page.getByTestId("v4-composer-input");
      await input.waitFor().catch((error) => {
        throw Error(errors.join("\n") || error.message);
      });
      await page.evaluate((theme) => window.__linked.theme(theme), theme);
      const trigger = page.getByTestId("linked-projects-trigger");
      const send = page.getByTestId("v4-composer-send");
      const add = async (path) => {
        await page.getByRole("textbox", { name: "项目路径" }).fill(path);
        await page.getByRole("button", { name: "添加", exact: true }).click();
      };
      await trigger.click();
      await add("backend");
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("textbox", { name: "项目路径" }).inputValue(), "backend");
      await add("/projects/missing");
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("linked-project-row").count(), 0);
      await add("/projects/backend");
      await page.getByTestId("linked-project-row").waitFor();
      assert.equal(await page.getByRole("checkbox").isChecked(), true);
      await page.getByRole("combobox", { name: "backend 的基准分支" }).click();
      await page.getByRole("option", { name: "test", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.__linked.calls.length),
        0,
        "Selecting a project is read only",
      );
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({ path: join(artifacts, `dialog-${width}-${theme}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const dialogBounds = await page.getByTestId("linked-projects-dialog").boundingBox();
      assert.ok(
        dialogBounds.x >= 15 && dialogBounds.x + dialogBounds.width <= width - 15,
        "Dialog retains mobile page margins",
      );
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await input.fill("请同时调整前端页面和后端接口");
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({ path: join(artifacts, `composer-${width}-${theme}.png`) });
      await page.evaluate(() => (window.__linked.fail = true));
      await send.click();
      await page.getByRole("alert").waitFor();
      assert.equal(await input.textContent(), "请同时调整前端页面和后端接口");
      assert.equal(await page.evaluate(() => window.__linked.sent.length), 0);
      await page.evaluate(() => (window.__linked.fail = false));
      await send.click();
      await page.waitForFunction(() => window.__linked.sent.length === 1);
      assert.equal(await page.evaluate(() => window.__linked.calls[1].startPoint), "commit-test");
      assert.match(
        await page.evaluate(() => window.__linked.sent[0].text),
        /\/worktrees\/2\/backend/,
      );
      await trigger.click();
      await page.getByTestId("linked-project-execution-path").waitFor();
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({ path: join(artifacts, `prepared-${width}-${theme}.png`) });
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await input.fill("继续联调");
      await send.click();
      await page.waitForFunction(() => window.__linked.sent.length === 2);
      assert.equal(
        await page.evaluate(() => window.__linked.calls.length),
        2,
        "Follow-up reuses prepared paths",
      );
      await page.evaluate(() => (window.__linked.trees["/worktrees/2/backend"].branch = "changed"));
      await input.fill("分支变更后不能发送");
      await send.click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.evaluate(() => window.__linked.sent.length), 2);
      await page.reload();
      await input.waitFor();
      assert.equal(
        await page.evaluate(
          () => window.__linked.draft.linkedRepositories[0].prepared.executionPath,
        ),
        "/worktrees/2/backend",
      );
      await page.evaluate(() => window.__linked.switch("B"));
      await page.waitForFunction(() => window.__linked.target === "B");
      await trigger.click();
      assert.equal(
        await page.getByTestId("linked-project-row").count(),
        0,
        "New scope does not inherit A",
      );
      await add("/projects/backend");
      await page.getByTestId("linked-project-row").waitFor();
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await page.evaluate(() => (window.__linked.delay = true));
      await input.fill("B delayed preparation");
      await send.click();
      await page.waitForFunction(() => window.__linked.pending.length === 1);
      await page.evaluate(() => window.__linked.switch("C"));
      await page.waitForFunction(() => window.__linked.target === "C");
      await input.fill("C draft");
      await page.evaluate(() => window.__linked.pending[0]());
      await page.waitForFunction(
        () => window.__linked.read("B")?.linkedRepositories?.[0]?.prepared,
      );
      assert.equal(await input.textContent(), "C draft");
      assert.equal(
        await page.evaluate(() => window.__linked.sent.length),
        0,
        "Late allocation cannot send or affect new scope",
      );
      assert.equal(
        await page.evaluate(() => window.__linked.draft.linkedRepositories?.length ?? 0),
        0,
      );
      await page.evaluate(() => {
        window.__linked.delay = false;
        window.__linked.switch("ACP");
      });
      await page.waitForFunction(() => window.__linked.target === "ACP");
      await trigger.click();
      await add("/projects/backend");
      await page.getByTestId("linked-project-row").waitFor();
      await page.getByRole("checkbox").uncheck();
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await input.fill("ACP backend change");
      await send.click();
      await page.waitForFunction(() => window.__linked.sent.length === 1);
      assert.equal(await page.evaluate(() => window.__linked.sent[0].kind), "acp");
      assert.match(
        await page.evaluate(() => window.__linked.sent[0].text),
        /executionPath.*\/projects\/backend/,
      );
      assert.deepEqual(errors, []);
      console.log(`PASS linked projects ${width}px ${theme}`);
      await context.close();
    }
  console.log(`Preview artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
