import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__quick-messages-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-quick-messages-"));
let server, browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SETTINGS_FRAME_CONTENT_CLASSNAME,SETTINGS_WIDE_FRAME_CONTENT_CLASSNAME} from '../../../ui/src/settings/SettingsPageParts.tsx';
    import {QuickMessagesSection} from '../../../ui/src/settings/QuickMessagesSection.tsx';
    import {ChatPromptEditor} from '../../../ui/src/prompt-editor/ChatPromptEditor.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {ConfirmDialogHost} from '../../../ui/src/ConfirmDialog.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {createSettingsPageConfig} from '../../../ui/src/settings/settingsPageConfig.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';import '../../../ui/src/styles.css';
    const state:any={settings:{quickMessages:[]},writes:0,sends:0,fail:false,remoteReads:0,remoteWrites:0};window.__quick=state;
    const services:any={settingService:{get:async()=>state.settings,update:async(patch:any)=>{if(state.fail)throw new Error('synthetic save failure');state.settings={...state.settings,...patch};state.writes++}},
      clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},fileService:{searchWorkspaceFiles:async()=>[]},
      acpService:{listPlugins:async()=>[],listAvailableAgents:async()=>[]},subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
      skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
      zcodeAgentService:{onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})}};
    useRemoteWorkspaceSessionStore.setState({baseServices:services});
    const remote:any={...services,settingService:{get:async()=>{state.remoteReads++;return {quickMessages:[{id:'remote',title:'WRONG HOST',content:'wrong'}]}},update:async()=>{state.remoteWrites++}}};
    state.setTheme=applyTheme;state.entries=createSettingsPageConfig({}).settingsSections.map(s=>s.id);
    function Fixture(){const [key,setKey]=useState(0),[acp,setAcp]=useState(false);const inputApiRef=useRef(null);state.remount=()=>setKey(k=>k+1);state.setAcp=setAcp;state.input=inputApiRef;
      return <main className='bg-background text-foreground p-4 min-h-dvh'><div data-testid='settings-frame' className={SETTINGS_WIDE_FRAME_CONTENT_CLASSNAME}><h2 className='text-ui-xl'>快捷消息</h2><QuickMessagesSection key={key}/></div><div data-testid='ordinary-frame' className={SETTINGS_FRAME_CONTENT_CLASSNAME}/><div className='mt-8 mx-auto max-w-2xl'><ServiceProvider services={remote}><ChatPromptEditor workspacePath='/synthetic' taskId={null} initialValue='保留草稿' inputApiRef={inputApiRef} inputTestId='quick-input' attachmentAction={{label:'添加附件',onSelect:()=>{},testId:'quick-plus'}} acpMode={acp} acpAgent={acp?'codex':undefined} enableMentionPanel={false} enableSlashCommands={false} onSubmit={()=>{state.sends++;return false}}/></ServiceProvider></div><ConfirmDialogHost/></main>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,onSettingsChanged:()=>()=>{}} as any}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000) },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const newButton = page.getByRole("button", { name: "新建", exact: true });
  await newButton.waitFor();
  const frame = page.getByTestId("settings-frame");
  const panel = page.getByTestId("quick-messages-panel");
  const frameBox = await frame.boundingBox();
  const ordinaryBox = await page.getByTestId("ordinary-frame").boundingBox();
  assert.ok(frameBox.width > ordinaryBox.width + 300);
  const tallPanel = await panel.boundingBox();
  assert.ok(tallPanel.height >= 700);
  await page.setViewportSize({ width: 1440, height: 800 });
  const shortPanel = await panel.boundingBox();
  assert.ok(shortPanel.height < tallPanel.height - 150);
  assert.ok(shortPanel.height >= 512);
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.ok(await page.evaluate(() => window.__quick.entries.includes("quickMessages")));
  await page.getByTestId("quick-plus").click();
  await page.getByText("暂无快捷消息，请在设置中创建。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  async function create(title, content) {
    await newButton.click();
    await page.getByLabel("标题", { exact: true }).fill(title);
    await page.getByLabel("内容", { exact: true }).fill(content);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(
      (title) => window.__quick.settings.quickMessages.some((m) => m.title === title),
      title,
    );
  }
  await create("检查代码", "第一行\n第二行  ");
  await create("提交变更", "请检查变更");
  await page.evaluate(() => window.__quick.remount());
  await page.getByTestId("quick-message-list").getByText("检查代码", { exact: true }).waitFor();
  const search = page.getByPlaceholder("按标题或内容搜索");
  await search.fill("第二行");
  assert.equal(await page.locator("[data-quick-message-row]").count(), 1);
  await search.fill("不存在");
  assert.equal(await page.locator("[data-quick-message-row]").count(), 0);
  await search.fill("");
  await page.getByTestId("quick-message-list").getByText("检查代码", { exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("未保存");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.getByLabel("标题", { exact: true }).inputValue(), "检查代码");
  await page.getByLabel("内容", { exact: true }).fill("   ");
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("修改后");
  await page.evaluate(() => (window.__quick.fail = true));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "synthetic save failure" }).waitFor();
  assert.equal(await page.getByLabel("标题", { exact: true }).inputValue(), "修改后");
  await page.evaluate(() => (window.__quick.fail = false));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.__quick.settings.quickMessages[0].title === "修改后");
  const handles = page.getByRole("button", { name: "拖动以调整顺序" });
  await page.waitForFunction(
    () => !document.querySelector("[data-quick-message-row] button")?.disabled,
  );
  await handles.first().focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-quick-message-row] button")?.getAttribute("aria-pressed") ===
      "true",
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.keyboard.press("ArrowDown");

  await page.waitForFunction(() =>
    document
      .querySelector("[role=status]")
      ?.textContent?.includes("droppable area " + window.__quick.settings.quickMessages[1].id),
  );
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__quick.settings.quickMessages[0].title === "提交变更");
  const source = await handles.first().boundingBox();
  const target = await handles.nth(1).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__quick.settings.quickMessages[0].title === "修改后");
  for (const acp of [false, true]) {
    await page.evaluate((acp) => {
      window.__quick.setAcp(acp);
      window.__quick.input.current.setText("保留草稿");
    }, acp);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.getByTestId("quick-plus").click();
    await page.getByRole("option", { name: "修改后" }).waitFor();
    assert.equal(await page.getByRole("option", { name: "WRONG HOST" }).count(), 0);
    if (acp) {
      await page.getByRole("option", { name: "修改后" }).click();
    } else {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction(() =>
      window.__quick.input.current.getText().includes("第一行\n第二行  "),
    );
    assert.equal(
      await page.evaluate(() => window.__quick.input.current.getText()),
      "保留草稿 第一行\n第二行  ",
    );
    assert.equal(await page.evaluate(() => window.__quick.sends), 0);
  }
  await page.getByTestId("quick-message-list").getByText("修改后", { exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^删除/ })
    .click();
  await page.waitForFunction(() => window.__quick.settings.quickMessages.length === 1);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByTestId("quick-message-list").getByText("提交变更", { exact: true }).click();
  await page.getByLabel("内容", { exact: true }).waitFor();
  const contentInput = page.getByLabel("内容", { exact: true });
  await contentInput.fill(Array.from({ length: 120 }, (_, i) => `长正文第 ${i + 1} 行`).join("\n"));
  const scrolls = await contentInput.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  );
  assert.equal(scrolls, true);
  const saveBox = await page.getByRole("button", { name: "保存", exact: true }).boundingBox();
  const panelBox = await panel.boundingBox();
  assert.ok(saveBox.y + saveBox.height <= panelBox.y + panelBox.height);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => window.__quick.setTheme("zai-dark"));
  await page.screenshot({
    path: join(artifacts, "desktop-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__quick.setTheme("zai-light"));
  await page.screenshot({
    path: join(artifacts, "mobile-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => window.__quick.remoteWrites), 0);
  assert.deepEqual(errors, []);
  console.log("Quick messages E2E passed. Artifacts:", artifacts);
} catch (error) {
  await page?.screenshot({
    path: join(artifacts, "failure.png"),
    fullPage: true,
    animations: "disabled",
  });
  console.error(
    "State:",
    await page?.evaluate(() => ({
      messages: window.__quick?.settings?.quickMessages,
      body: document.body.innerText,
    })),
  );
  console.error("Browser errors:", errors);
  console.error("Artifacts:", artifacts);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
