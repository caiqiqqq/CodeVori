// Real UI primitives and editor; synthetic services only, no credentials or model calls.
// Run with the desktop Vite server; ZCODE_E2E_BASE_URL can select an isolated server.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__shared-trigger-refs-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-trigger-refs-"));
const failures = [];
let browser;
console.log(`Shared trigger screenshots: ${artifacts}`);

try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useCallback, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Slot} from 'radix-ui';
    import {Folder, Plus} from 'lucide-react';
    import {ControlHintTooltip} from '../../../ui/src/ControlHintTooltip.tsx';
    import {Button} from '../../../ui/src/components/ui/button.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {Popover,PopoverContent,PopoverTrigger} from '../../../ui/src/components/ui/popover.tsx';
    import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '../../../ui/src/components/ui/dropdown-menu.tsx';
    import {WorkspaceHelpMenuButton} from '../../../ui/src/WorkspaceHelpMenuButton.tsx';
    import {ChatPromptEditor} from '../../../ui/src/prompt-editor/ChatPromptEditor.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import '../../../ui/src/styles.css';
    const scenario=new URLSearchParams(location.search).get('scenario');
    const state:any={attach:0,detach:0,cleanup:0,childAttach:0,childDetach:0,childCleanup:0,errors:[],calls:[],clicks:[],node:null,objectRef:{current:null}};
    window.__triggerRefs=state;
    class Boundary extends React.Component<any,any>{
      state={error:null};
      static getDerivedStateFromError(error:any){return {error}};
      componentDidCatch(error:any){state.errors.push(error.message)};
      render(){return this.state.error?<div data-testid="fixture-error">{this.state.error.message}</div>:this.props.children}
    }
    function RefFixture(){
      const [revision,setRevision]=useState(0);
      const [visible,setVisible]=useState(true);
      const [disabled,setDisabled]=useState(false);
      const [open,setOpen]=useState(false);
      const [menuOpen,setMenuOpen]=useState(false);
      const [,setAnchor]=useState<any>(null);
      state.rerender=()=>setRevision(value=>value+1);
      state.hide=()=>setVisible(false);
      state.show=()=>setVisible(true);
      state.disable=setDisabled;
      const triggerRef=useCallback((node:HTMLElement|null)=>{
        if(node){state.attach++;state.node=node}else state.detach++;
        if(scenario?.includes('stateful'))setAnchor(node?{node}:null);
        if(node&&scenario?.includes('cleanup'))return ()=>{state.cleanup++};
      },[]);
      const childRef=useCallback((node:HTMLElement|null)=>{
        if(node){state.childAttach++;state.childNode=node}else state.childDetach++;
        if(node&&scenario?.includes('cleanup')&&!scenario?.includes('mixed'))return ()=>{state.childCleanup++};
      },[]);
      const button=<Button ref={childRef} disabled={disabled} data-testid="fixture-trigger" type="button" variant="ghost" size="icon-md" aria-label="Workspace" onClick={()=>state.clicks.push('child')}><Folder className="size-4"/></Button>;
      const nestedTrigger=scenario?.startsWith('dropdown')?<DropdownMenuTrigger asChild disabled={disabled}>{button}</DropdownMenuTrigger>:scenario?.startsWith('popover')?<PopoverTrigger asChild>{button}</PopoverTrigger>:button;
      const tooltip=<ControlHintTooltip title={'Workspace '+revision} triggerRef={scenario?.includes('object')?state.objectRef:triggerRef} {...(scenario?.startsWith('header')?{open,onOpenChange:setOpen}:{})}>{nestedTrigger}</ControlHintTooltip>;
      const control=scenario?.startsWith('dropdown')?<DropdownMenu {...(scenario?.includes('controlled')?{open:menuOpen,onOpenChange:setMenuOpen}:{})}>{tooltip}<DropdownMenuContent><DropdownMenuItem data-testid="menu-action" onSelect={()=>state.clicks.push('select')}>Menu action</DropdownMenuItem></DropdownMenuContent></DropdownMenu>:scenario?.startsWith('popover')?<Popover>{tooltip}<PopoverContent><button data-testid="menu-action">Menu action</button></PopoverContent></Popover>:tooltip;
      return <main className="bg-background text-foreground p-4"><div className="flex h-8 items-center gap-2">{visible?control:null}</div><span data-testid="revision">{revision}</span></main>;
    }
    function SlotFixture(){
      const [kind,setKind]=useState('null');
      const [revision,setRevision]=useState(0);
      state.kind=setKind;state.rerender=()=>setRevision(value=>value+1);
      const ref=useCallback((node:any)=>{if(node){state.attach++;state.node=node}else state.detach++},[]);
      const childRef=useCallback((node:any)=>{if(node)state.childAttach++;else state.childDetach++},[]);
      const button=<button ref={childRef} data-testid="slot-button" className="child" style={{color:'red'}} onClick={()=>state.clicks.push('child')}>{revision}</button>;
      const child=kind==='null'?null:kind==='fragment'?<React.Fragment><span data-testid="slot-fragment">Fragment</span></React.Fragment>:kind==='slottable'?[<Plus key="icon"/>,<Slot.Slottable key="content">{button}</Slot.Slottable>]:button;
      const slotProps=kind==='fragment'?{}:{className:'slot',style:{backgroundColor:'black'},onClick:()=>state.clicks.push('slot')};
      return <Slot.Root ref={ref} {...slotProps}>{child}</Slot.Root>;
    }
    const noopSubscription=()=>()=>({dispose(){}});
    const services:any={
      clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
      fileService:{searchWorkspaceFiles:async()=>[{path:'/synthetic/project/file.ts',relativePath:'file.ts',name:'file.ts',type:'file'}]},
      pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},
      subagentsService:{list:async()=>[]},
      zcodeSessionService:{list:async()=>[]},
      skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
      acpService:{listPlugins:async()=>[],create:async()=>{state.calls.push('create');throw new Error('No real ACP connection')},prompt:async()=>{state.calls.push('prompt');throw new Error('No model requests')}},
      zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:noopSubscription,onAgentRuntimeLifecycleChanged:()=>({dispose(){}})}
    };
    const platform:any={isMacOS:false,isWindows:false,isLinux:true,isWeb:true,selectDirectory:async()=>null};
    function EditorFixture(){
      const [agent,setAgent]=useState<string|null>(null);
      state.agent=setAgent;
      return <main className="flex min-h-screen items-end bg-background text-foreground p-4"><div className="mx-auto w-full max-w-2xl"><ChatPromptEditor workspacePath="/synthetic/project" taskId="native-session" acpMode={Boolean(agent)} acpAgent={agent as any} acpSessionId={agent?'acp-'+agent:null} enableMentionPanel enableSlashCommands={!agent} inputTestId="fixture-editor" attachmentAction={{label:'添加附件',testId:'fixture-plus',menuItemTestId:'fixture-attachment',onSelect:()=>state.calls.push('attachment')}} onSubmit={()=>{state.calls.push('submit');return false}} submitLabel="发送"/></div></main>;
    }
    function HelpFixture(){
      const [revision,setRevision]=useState(0);
      state.rerender=()=>setRevision(value=>value+1);
      return <main className="bg-background text-foreground p-4"><WorkspaceHelpMenuButton/><span data-testid="revision">{revision}</span></main>;
    }
    const fixture=scenario==='editor'?<EditorFixture/>:scenario==='slot'?<SlotFixture/>:scenario==='help'?<React.StrictMode><HelpFixture/></React.StrictMode>:<RefFixture/>;
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Boundary>{fixture}</Boundary></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  const base = process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174";
  async function run(scenario, exercise, width = 1280, dark = false) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${base}/${name}.html?scenario=${scenario}`);
      await page.waitForFunction(() => window.__triggerRefs);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.theme = dark ? "zai-dark" : "zai-light";
      }, dark);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.deepEqual(await page.evaluate(() => window.__triggerRefs.errors), [], scenario);
      await exercise(page);
      assert.deepEqual(errors, [], "No uncaught UI error");
      assert.deepEqual(await page.evaluate(() => window.__triggerRefs.errors), []);
      console.log(`PASS ${scenario} ${width}px ${dark ? "dark" : "light"}`);
    } catch (error) {
      failures.push(`${scenario} ${width}px: ${error.stack || error.message}`);
      console.error(`FAIL ${scenario} ${width}px: ${error.message}`);
      await page.screenshot({ path: join(artifacts, `${scenario}-${width}-failed.png`) });
    } finally {
      await page.close();
    }
  }
  for (const scenario of [
    "header-stateful",
    "popover-stateful",
    "header-cleanup",
    "popover-cleanup",
    "header-mixed-cleanup",
    "popover-object-cleanup",
    "dropdown-stateful",
    "dropdown-cleanup",
    "dropdown-mixed-cleanup",
    "dropdown-object-cleanup",
    "dropdown-controlled-stateful",
  ]) {
    await run(scenario, async (page) => {
      const trigger = page.getByTestId("fixture-trigger");
      await trigger.waitFor();
      const callbackAttaches = scenario.includes("object") ? 0 : 1;
      assert.equal(
        await page.evaluate(() => window.__triggerRefs.attach),
        callbackAttaches,
        "Attach once",
      );
      assert.equal(await page.evaluate(() => window.__triggerRefs.childAttach), 1);
      if (scenario.includes("object"))
        assert.ok(
          await page.evaluate(
            () => window.__triggerRefs.objectRef.current === window.__triggerRefs.childNode,
          ),
        );
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.__triggerRefs.rerender());
        await page
          .getByTestId("revision")
          .filter({ hasText: String(i + 1) })
          .waitFor();
      }
      assert.equal(
        await page.evaluate(
          () =>
            window.__triggerRefs.childNode ===
            document.querySelector('[data-testid="fixture-trigger"]'),
        ),
        true,
      );
      assert.equal(
        await page.evaluate(() => window.__triggerRefs.attach),
        callbackAttaches,
        "No ref churn on metadata updates",
      );
      assert.equal(await page.evaluate(() => window.__triggerRefs.childAttach), 1);
      assert.equal(await page.evaluate(() => window.__triggerRefs.detach), 0);
      if (scenario.startsWith("popover") || scenario.startsWith("dropdown")) {
        await trigger.click();
        await page.getByTestId("menu-action").waitFor();
        await page.keyboard.press("Escape");
        await page.getByTestId("menu-action").waitFor({ state: "hidden" });
        await trigger.focus();
        await page.keyboard.press("Enter");
        await page.getByTestId("menu-action").waitFor();
        await page.keyboard.press("Escape");
        await page.getByTestId("menu-action").waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
        if (scenario.startsWith("dropdown")) {
          await trigger.click();
          await page.getByTestId("menu-action").click();
          await page.getByTestId("menu-action").waitFor({ state: "hidden" });
          assert.ok(await page.evaluate(() => window.__triggerRefs.clicks.includes("select")));
          assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
        }
      } else {
        await trigger.hover();
        await page.getByRole("tooltip").waitFor();
        await page.keyboard.press("Escape");
      }
      await page.evaluate(() => window.__triggerRefs.disable(true));
      await page.waitForFunction(
        () => document.querySelector('[data-testid="fixture-trigger"]').disabled,
      );
      await trigger.click({ force: true });
      assert.equal(await page.getByTestId("menu-action").count(), 0);
      await page.evaluate(() => window.__triggerRefs.disable(false));
      assert.equal(await page.locator("button button").count(), 0);
      await page.evaluate(() => window.__triggerRefs.hide());
      await trigger.waitFor({ state: "hidden" });
      const counts = await page.evaluate(() => {
        const { detach, cleanup, childDetach, childCleanup } = window.__triggerRefs;
        return { detach, cleanup, childDetach, childCleanup };
      });
      const expected = scenario.includes("object")
        ? { detach: 0, cleanup: 0, childDetach: 0, childCleanup: 1 }
        : scenario.includes("mixed")
          ? { detach: 0, cleanup: 1, childDetach: 1, childCleanup: 0 }
          : scenario.includes("cleanup")
            ? { detach: 0, cleanup: 1, childDetach: 0, childCleanup: 1 }
            : { detach: 1, cleanup: 0, childDetach: 1, childCleanup: 0 };
      assert.deepEqual(counts, expected);
      assert.equal(await page.evaluate(() => window.__triggerRefs.objectRef.current), null);
    });
  }
  await run("help", async (page) => {
    const trigger = page.getByTestId("workspace-help-menu-trigger");
    await trigger.waitFor();
    for (let revision = 1; revision <= 3; revision++) {
      await page.evaluate(() => window.__triggerRefs.rerender());
      await page
        .getByTestId("revision")
        .filter({ hasText: String(revision) })
        .waitFor();
      await trigger.hover();
      await page.getByRole("tooltip").waitFor();
      await trigger.click();
      await page.getByRole("menu").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
    }
    assert.deepEqual(await page.evaluate(() => window.__triggerRefs.calls), []);
    assert.equal(await page.locator("button button").count(), 0);
    await page.screenshot({ path: join(artifacts, "workspace-help-menu.png") });
  });
  await run("slot", async (page) => {
    for (const kind of ["element", "null", "fragment", "slottable", "element"]) {
      await page.evaluate((kind) => window.__triggerRefs.kind(kind), kind);
      if (kind === "element" || kind === "slottable") {
        const button = page.getByTestId("slot-button");
        await button.waitFor();
        assert.match(await button.getAttribute("class"), /slot child/);
        assert.equal(await button.evaluate((node) => node.style.color), "red");
        assert.equal(await button.evaluate((node) => node.style.backgroundColor), "black");
        const before = await page.evaluate(() => window.__triggerRefs.attach);
        await page.evaluate(() => window.__triggerRefs.rerender());
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        assert.equal(await page.evaluate(() => window.__triggerRefs.attach), before);
        await button.click();
        assert.deepEqual(await page.evaluate(() => window.__triggerRefs.clicks.slice(-2)), [
          "child",
          "slot",
        ]);
      } else if (kind === "fragment") await page.getByTestId("slot-fragment").waitFor();
      else await page.getByTestId("slot-button").waitFor({ state: "hidden" });
    }
  });
  for (const width of [1280, 320])
    for (const dark of [false, true]) {
      await run(
        "editor",
        async (page) => {
          const input = page.getByTestId("fixture-editor");
          const plus = page.getByTestId("fixture-plus");
          await input.waitFor();
          await input.fill("保留这条未发送的草稿");
          await page.evaluate(() => {
            window.__triggerRefs.input = document.querySelector('[data-testid="fixture-editor"]');
          });
          const firstBounds = await plus.boundingBox();
          for (const agent of ["codex", "claude", null, "codex", null]) {
            await page.evaluate((agent) => window.__triggerRefs.agent(agent), agent);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
            assert.equal(
              await page.evaluate(
                () =>
                  window.__triggerRefs.input ===
                  document.querySelector('[data-testid="fixture-editor"]'),
              ),
              true,
            );
            assert.equal(await input.innerText(), "保留这条未发送的草稿");
            await plus.click();
            await page.getByTestId("fixture-attachment").waitFor();
            await page.getByRole("option").filter({ hasText: "file.ts" }).waitFor();
            if (agent) await page.getByRole("option").filter({ hasText: "工作流" }).waitFor();
            await page.screenshot({
              path: join(
                artifacts,
                `editor-${width}-${dark ? "dark" : "light"}-${agent ?? "api"}-menu.png`,
              ),
              animations: "disabled",
            });
            await page.keyboard.press("Escape");
            await page.getByTestId("fixture-attachment").waitFor({ state: "hidden" });
            const bounds = await plus.boundingBox();
            assert.equal(bounds.width, firstBounds.width);
            assert.equal(bounds.height, firstBounds.height);
          }
          assert.deepEqual(await page.evaluate(() => window.__triggerRefs.calls), []);
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            "No horizontal overflow",
          );
          await page.screenshot({
            path: join(artifacts, `editor-${width}-${dark ? "dark" : "light"}.png`),
            animations: "disabled",
          });
        },
        width,
        dark,
      );
    }
  assert.equal(failures.length, 0, failures.join("\n\n"));
  console.log(`PASS shared trigger refs and real API/ACP editor. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
