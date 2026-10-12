// 真实会话行 + 模拟 Host；验证选中反馈，不连接模型或改动用户历史。
// ZCODE_E2E_VITE_URL=http://127.0.0.1:5186 node packages/ui/test/sidebarConversationSelection.e2e.mjs
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__sidebar-selection-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const output = process.env.ZCODE_E2E_SCREENSHOT_DIR ?? "/tmp/zcode-sidebar-selection";
let browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {DndContext,PointerSensor,useSensor,useSensors} from '@dnd-kit/core';
    import {Folder, ChevronDown, ListTodo, Pin} from 'lucide-react';
    import {MemoTaskItem} from '../../../ui/src/TaskListItem.tsx';
    import {WorkspaceAcpTaskItem} from '../../../ui/src/WorkspaceAcpTaskItem.tsx';
    import {GroupedTaskRow} from '../../../ui/src/workspace-grouped-tasks/task-row.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {StoreProvider,useZCodeStore} from '../../../ui/src/store/StoreProvider.tsx';
    import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const path='/fixture/zcode', now=Date.now();
    const tasks=['梳理仓库登录流程','修复 GitLab 图片显示'].map((title,i)=>({
      taskId:'api-'+i,title,workspacePath:path,provider:'glm',status:'idle',
      model:'bigmodel/GLM-5',createdAt:now-i*1000,updatedAt:now-i*1000,
    }));
    const sessions=['检查多仓库兼容性','增强任务选中反馈'].map((title,i)=>({
      id:'acp-'+i,title,agent:i?'codex':'claude',workspacePath:path,
      status:'ready',pinned:false,createdAt:now-i*1000,updatedAt:now-i*1000,
    }));
    const state={calls:[],selections:[]}; window.__selection=state;
    connectProviderSettingsSnapshot({getView:async()=>({revision:1,providers:[{
      providerId:'bigmodel',enabled:true,effectiveConfig:{logo:{type:'builtin',key:'bigmodel'}},
      models:[],issues:[],executable:true,
    }],providerTemplates:[],providerOrder:[]}),onDidChange:()=>({dispose(){}})});
    const action=kind=>(...args)=>state.calls.push({kind,args});
    const acpService={updateRow:async input=>state.calls.push({kind:'acp',input})};
    const services={zcodeTaskService:{},acpService,
      windowControllerService:{
        onDynamicControllerFrame:()=>()=>({dispose(){}}),
        subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),
        unsubscribeControllerV4:async()=>{},
      },
    };
    const broadcastService={send(){},onMessage(){return {dispose(){}}}};
    function FixtureDnd({children}){
      const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
      return <DndContext sensors={sensors}>{children}</DndContext>;
    }
    function Fixture(){
      const {intl}=useZCodeIntl();
      const [mode,setMode]=useState('project');
      const [active,setActive]=useState('acp-1');
      const [confirm,setConfirm]=useState(null);
      state.mode=setMode;state.active=setActive;state.theme=useZCodeStore(s=>s.setTheme);
      const select=id=>{state.selections.push(id);setActive(id)};
      const callbacks={onStartRenameTask:action('rename'),onArchiveTask:action('archive'),onMarkTaskAsUnread:action('unread')};
      return <aside data-testid="selection-fixture" data-mode={mode} style={{width:'min(320px, calc(100vw - 24px))',margin:'12px',padding:'16px 12px 28px',background:'var(--color-sidebar)',color:'var(--color-foreground)',borderRadius:'12px',border:'1px solid var(--color-border)'}}>
        <div className="mb-5 flex items-center gap-2 text-ui-lg font-semibold"><ListTodo className="size-4"/>任务</div>
        <div className="mb-4 flex items-center gap-2 text-ui-base text-foreground-muted"><Pin className="size-3.5"/>置顶</div>
        <div className="mb-3 text-ui-sm text-foreground-subtle">项目</div>
        <div className="mb-2 flex items-center gap-2 text-ui-base"><ChevronDown className="size-3.5"/><Folder className="size-4"/><span className="font-medium">zcode</span></div>
        <ul className="ml-2 space-y-1">{tasks.map(task=><li key={task.taskId} data-fixture-id={task.taskId}>
          {mode==='grouped'||mode==='overlay'?<GroupedTaskRow task={task} groups={[]} dragId={task.taskId} workspaceLabel="zcode" activeWorkspacePath={path} activeTaskId={active}
            onSelectTask={(_,id)=>select(id)} onCloseTask={action('close')} onMoveTaskToGroup={action('group')} onMoveTaskToTop={action('top')} {...callbacks} dragOverlay={mode==='overlay'}/>:
          <ul><MemoTaskItem task={task} workspacePath={path} isPinned={mode==='pinned'} isActive={active===task.taskId}
            isWorktree={task.taskId==='api-1'} variant={mode==='timeline'?'timeline':'default'} intl={intl} onSelectTask={select}
            onArchiveTaskInline={(event,id)=>{event.preventDefault();event.stopPropagation();setConfirm(id)}} onCancelArchiveConfirm={()=>setConfirm(null)}
            isArchiveConfirming={confirm===task.taskId} onTogglePinTask={action('pin')} {...callbacks}/></ul>}
        </li>)}{sessions.map(session=><li key={session.id} data-fixture-id={session.id}><ul><WorkspaceAcpTaskItem
          session={{...session,pinned:mode==='pinned'}} service={acpService} active={active===session.id}
          variant={mode==='timeline'?'timeline':'default'} isWorktree={session.id==='acp-0'} onSelect={()=>select(session.id)}/></ul></li>)}</ul>
        <div className="mt-6 border-t border-border pt-4 text-ui-sm text-foreground-muted">当前会话使用蓝色边线和左侧标记</div>
      </aside>;
    }
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isLinux:true,isWindows:false}}>
      <StoreProvider broadcastService={broadcastService}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><FixtureDnd><Fixture/></FixtureDnd></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></StoreProvider>
    </PlatformProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 720 },
        deviceScaleFactor: 2,
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/${name}.html`);
      const fixture = page.getByTestId("selection-fixture");
      await fixture.waitFor().catch((error) => {
        throw new Error(errors.join("\n") || error.message);
      });
      await page.evaluate((theme) => window.__selection.theme(theme), theme);
      await page.waitForFunction(
        (theme) => document.documentElement.classList.contains(`theme-${theme}`),
        theme,
      );
      const row = (id) => fixture.locator(`[data-fixture-id="${id}"] .sidebar-conversation-row`);
      const tokens = await page.evaluate(() => {
        const sample = document.createElement("div");
        document.body.append(sample);
        sample.style.backgroundColor = "var(--color-accent)";
        const accent = getComputedStyle(sample).backgroundColor;
        sample.style.backgroundColor = "var(--color-icon-blue)";
        const blue = getComputedStyle(sample).backgroundColor;
        sample.remove();
        return { accent, blue };
      });
      const presentation = (item) =>
        item.evaluate((element) => {
          const style = getComputedStyle(element);
          const marker = getComputedStyle(element, "::before");
          return {
            background: style.backgroundColor,
            shadow: style.boxShadow,
            markerColor: marker.backgroundColor,
            markerWidth: marker.width,
            markerContent: marker.content,
            markerEvents: marker.pointerEvents,
          };
        });
      const assertSelected = async (item) => {
        await page.waitForFunction(
          ({ element, accent }) =>
            element.dataset.selected === "true" &&
            getComputedStyle(element).backgroundColor === accent,
          { element: await item.elementHandle(), accent: tokens.accent },
        );
        assert.equal(await item.getAttribute("data-selected"), "true");
        assert.equal(await item.getAttribute("aria-current"), "page");
        const style = await presentation(item);
        assert.equal(style.background, tokens.accent);
        assert.equal(style.shadow, `${tokens.blue} 0px 0px 0px 1px inset`);
        assert.equal(style.markerColor, tokens.blue);
        assert.equal(style.markerWidth, "4px");
        assert.equal(style.markerEvents, "none");
      };
      const geometry = (item) =>
        item.evaluate((element) => {
          const title = element.querySelector("[title]");
          return {
            height: element.getBoundingClientRect().height,
            titleLeft: title?.getBoundingClientRect().left,
          };
        });
      await assertSelected(row("acp-1"));
      if (theme.startsWith("zai-")) {
        await fixture.screenshot({
          path: join(output, `${theme}-${width === 375 ? "mobile" : "desktop"}.png`),
        });
      }
      for (const mode of ["project", "timeline", "pinned", "grouped"]) {
        await page.evaluate((mode) => window.__selection.mode(mode), mode);
        await fixture.locator(`:scope[data-mode="${mode}"]`).waitFor();
        for (const id of ["api-0", "acp-1"]) {
          const item = row(id);
          await page.mouse.move(width - 2, 2);
          await page.evaluate(() => {
            document.activeElement?.blur();
            window.__selection.active(null);
          });
          await item.locator("[data-task-agent-icon], [data-acp-agent-icon]").waitFor();
          const before = await geometry(item);
          await item.click();
          await assertSelected(item);
          assert.deepEqual(
            await geometry(item),
            before,
            `${mode}: selection must not move title or change row height`,
          );
          await item.hover();
          await assertSelected(item);
          assert.deepEqual(
            await geometry(item),
            before,
            `${mode}: hover must not move title or change row height`,
          );
          // 焦点与当前会话分开：聚焦不能选择，Enter / Space 才调用原有导航。
          await page.evaluate(() => window.__selection.active(null));
          await page.keyboard.press("Tab");
          await item.focus();
          assert.equal(await item.getAttribute("data-selected"), "false");
          assert.equal(await item.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
          await page.keyboard.press("Enter");
          await assertSelected(item);
          await page.evaluate(() => window.__selection.active(null));
          await page.keyboard.press("Space");
          await assertSelected(item);
          assert.equal(await fixture.locator('[data-selected="true"]').count(), 1);
          assert.equal(
            await row(id === "api-0" ? "acp-1" : "api-0").getAttribute("aria-current"),
            null,
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      }
      // 原有右侧动作不得冒泡选择会话，选中反馈保留。
      await page.evaluate(() => {
        window.__selection.mode("project");
        window.__selection.active("api-0");
      });
      const native = row("api-0");
      await native.hover();
      const beforeActions = await geometry(native);
      const pin = native.getByRole("button", { name: "置顶任务", exact: true });
      const pinBox = await pin.boundingBox();
      await page.evaluate(() => window.__selection.active(null));
      assert.deepEqual(await pin.boundingBox(), pinBox, "Selection must not move action buttons");
      const selections = await page.evaluate(() => window.__selection.selections.length);
      await pin.click();
      assert.equal(await page.evaluate(() => window.__selection.selections.length), selections);
      assert.deepEqual(await geometry(native), beforeActions);
      await page.evaluate(() => window.__selection.active("acp-1"));
      const acp = row("acp-1");
      await acp.hover();
      await acp.getByRole("button", { name: "置顶任务", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__selection.selections.length), selections);
      await assertSelected(acp);
      await page.evaluate(() => {
        window.__selection.mode("overlay");
        window.__selection.active("api-0");
      });
      assert.equal(await row("api-0").getAttribute("data-selected"), "false");
      assert.equal(await row("api-0").getAttribute("aria-current"), null);
      assert.equal((await presentation(row("api-0"))).markerContent, "none");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `PASS ${width}px ${theme}: API / ACP selection, variants, keyboard, actions, overlay`,
      );
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
