// Real native rows with fake task/Host metadata; no prompts or user history mutations.
// node packages/ui/test/nativeConversationIcons.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { assertYellowWaitingIndicator } from "./waitingResponseIndicatorAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__native-conversation-icons-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {DndContext} from '@dnd-kit/core';
    import {MemoTaskItem} from '../../../ui/src/TaskListItem.tsx';
    import {GroupedTaskRow} from '../../../ui/src/workspace-grouped-tasks/task-row.tsx';
    import {WorkspaceArchivedTasksFlatSection} from '../../../ui/src/WorkspaceArchivedTasksFlatSection.tsx';
    import {attachTaskListRowActivity} from '../../../ui/src/v4/taskListRowActivity.ts';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {StoreProvider,useZCodeStore} from '../../../ui/src/store/StoreProvider.tsx';
    import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
    import {ProviderLogo} from '../../../ui/src/settings/model-provider-section/ProviderLogo.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const path='/fixture/repo', now=Date.now();
    const cases=[
      {id:'idle'}, {id:'legacy',provider:undefined},
      {id:'error',model:'custom-openai/GLM-5',status:'error',unreadAt:123,phase:'error'},
      {id:'unread',model:'custom-anthropic/GLM-5',unreadAt:123,phase:'running'},
      {id:'running',model:'disabled-provider/GLM-5',phase:'running'}, {id:'prewarming',model:'router/GLM-5',phase:'prewarming'},
      {id:'stale',model:undefined,status:'running'}, {id:'completed',model:'removed-provider/GLM-5',status:'error',phase:'completedSuccess'},
    ];
    const tasks=cases.map(({id,phase,...fields},i)=>{
      const task={taskId:id,title:'对话 '+id,workspacePath:path,provider:'glm',status:'idle',model:'bigmodel-api/GLM-5',createdAt:now-i*1000,updatedAt:now-i*1000,...fields};
      return phase?attachTaskListRowActivity(task,{phase,lastActivityAt:now,hasBackgroundWork:false}):task;
    });
    const tabs=[{id:'fixture-tab',kind:'workspace',workspacePath:path,label:'repo'}];
    const state={calls:[],providerReads:0};
    window.__nativeIcons=state;
    const providers=[['bigmodel-api','bigmodel'],['custom-openai','openai'],['custom-anthropic','anthropic'],['disabled-provider','deepseek'],['router','openrouter'],['no-logo',null]].map(([providerId,key])=>({
      providerId,enabled:providerId!=='disabled-provider',effectiveConfig:{logo:key?{type:'builtin',key}:null},models:[],issues:[],executable:true,
    }));
    let view={revision:1,providers,providerTemplates:[],providerOrder:[]};
    const providerListeners=new Set();
    connectProviderSettingsSnapshot({getView:async()=>{state.providerReads++;return view;},onDidChange:listener=>{providerListeners.add(listener);return {dispose(){providerListeners.delete(listener)}}}});
    state.logo=key=>{view={...view,revision:view.revision+1,providers:view.providers.map(p=>p.providerId==='bigmodel-api'?{...p,effectiveConfig:{logo:{type:'builtin',key}}}:p)};for(const listener of providerListeners)listener(view);};
    const action=(kind)=>(...args)=>state.calls.push({kind,args});
    const services={
      zcodeTaskService:{},
      acpService:{list:async()=>[],onDynamicSessionChanged:()=>()=>({dispose(){}})},
      windowControllerService:{
        onDynamicControllerFrame:()=>()=>({dispose(){}}),
        subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),
        unsubscribeControllerV4:async()=>{},
        listTaskList:async()=>({items:tasks,total:tasks.length,hasMore:false}),
      },
    };
    const broadcastService={send(){},onMessage(){return {dispose(){}}}};
    function Fixture(){
      const {intl}=useZCodeIntl();
      const [mode,setMode]=useState('default');
      const [model,setModel]=useState('bigmodel-api/GLM-5');
      const [composer,setComposer]=useState('bigmodel-api/GLM-5');
      const [confirm,setConfirm]=useState(null);
      state.mode=setMode; state.model=setModel; state.composer=setComposer; state.theme=useZCodeStore(s=>s.setTheme);
      const callbacks={onStartRenameTask:action('rename'),onArchiveTask:action('archive'),onMarkTaskAsUnread:action('unread')};
      return <><aside data-testid="settings-logo-reference">{providers.map(p=><span key={p.providerId} data-reference-provider={p.providerId}><ProviderLogo logo={p.effectiveConfig.logo} className="size-4"/></span>)}</aside><main data-testid="native-icons-fixture" data-mode={mode} data-composer={composer} style={{width:'min(300px, calc(100vw - 24px))',margin:'20px 12px',backgroundColor:'var(--color-sidebar)'}}>
        {mode==='archived'?<WorkspaceArchivedTasksFlatSection workspaceTabs={tabs} activeWorkspacePath={path} activeTaskId={null} sortBy="created" onSelectTask={action('select')}/>:
        <ul className="space-y-1">{tasks.map(task=><li key={mode+task.taskId} data-fixture-row={task.taskId}>
          {mode==='grouped'||mode==='overlay'?<GroupedTaskRow task={task} groups={[]} workspaceLabel="repo" activeWorkspacePath={path} activeTaskId={null}
            onSelectTask={action('select')} onCloseTask={action('close')} onMoveTaskToGroup={action('group')} onMoveTaskToTop={action('top')}
            {...callbacks} dragOverlay={mode==='overlay'}/>:
          <ul><MemoTaskItem task={task.taskId==='idle'?{...task,model}:task} workspacePath={path} isPinned={mode==='pinned'} isActive={false}
            variant={mode==='timeline'?'timeline':'default'} intl={intl} onSelectTask={action('select')}
            onArchiveTaskInline={(event,id)=>{event.preventDefault();event.stopPropagation();setConfirm(id)}} onCancelArchiveConfirm={()=>setConfirm(null)}
            isArchiveConfirming={confirm===task.taskId} onTogglePinTask={action('pin')} {...callbacks}/></ul>}
        </li>)}</ul>}
      </main></>;
    }
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isLinux:true,isWindows:false}}>
      <StoreProvider broadcastService={broadcastService}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><DndContext><Fixture/></DndContext></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></StoreProvider>
    </PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("response", async (response) => {
        if (response.status() >= 400) {
          errors.push(`${response.url()}: ${(await response.text()).slice(0, 4000)}`);
        }
      });
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate(
        (theme) =>
          (document.documentElement.className =
            theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light"),
        theme,
      );
      const fixture = page.getByTestId("native-icons-fixture");
      await fixture.waitFor().catch((error) => {
        throw new Error(errors.join("\n") || error.message);
      });
      await page.evaluate(
        (theme) => window.__nativeIcons.theme(theme === "dark" ? "zai-dark" : "zai-light"),
        theme,
      );
      for (const mode of ["default", "timeline", "pinned", "grouped", "overlay", "archived"]) {
        await page.evaluate((mode) => window.__nativeIcons.mode(mode), mode);
        await page.locator(`[data-mode="${mode}"]`).waitFor();
        const idle =
          mode === "archived"
            ? fixture.locator("li").filter({ has: page.getByText("对话 idle", { exact: true }) })
            : page.locator('[data-fixture-row="idle"]');
        await idle.locator('[data-task-agent-icon="api"] img').waitFor();
        assert.equal(
          await fixture.locator('[data-task-agent-icon="api"]').count(),
          8,
          `${mode}: every API row needs its icon`,
        );
        for (const id of [
          "idle",
          "legacy",
          "error",
          "unread",
          "running",
          "prewarming",
          "stale",
          "completed",
        ]) {
          const row =
            mode === "archived"
              ? fixture.locator("li").filter({ has: page.getByText(`对话 ${id}`, { exact: true }) })
              : page.locator(`[data-fixture-row="${id}"]`);
          const icon = row.locator('[data-task-agent-icon="api"]');
          assert.equal(await icon.isVisible(), true);
          const provider = {
            idle: "bigmodel-api",
            legacy: "bigmodel-api",
            error: "custom-openai",
            unread: "custom-anthropic",
            running: "disabled-provider",
            prewarming: "router",
          }[id];
          if (provider) {
            assert.equal(await icon.getAttribute("data-task-provider-id"), provider);
            assert.equal(
              await icon.locator("img").getAttribute("src"),
              await page.locator(`[data-reference-provider="${provider}"] img`).getAttribute("src"),
              "API and model settings use the same provider logo asset",
            );
          } else {
            assert.equal(
              await icon.locator("img").count(),
              0,
              "Unknown or missing metadata uses the settings default icon",
            );
            assert.equal(await icon.locator("svg.lucide-package").count(), 1);
          }
          assert.equal(await icon.getAttribute("aria-hidden"), "true");
          assert.deepEqual(
            await icon.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return [r.width, r.height];
            }),
            [16, 16],
          );
          const expected =
            mode === "archived"
              ? null
              : id === "error"
                ? "error"
                : id === "unread"
                  ? "unread"
                  : ["running", "prewarming"].includes(id)
                    ? "loading"
                    : null;
          assert.equal(await row.locator("[data-task-status-indicator]").count(), expected ? 1 : 0);
          if (expected)
            assert.equal(
              await row
                .locator("[data-task-status-indicator]")
                .getAttribute("data-task-status-indicator"),
              expected,
            );
          assert.equal(await row.locator("[data-idle-indicator]").count(), 0);
          if (expected === "loading") {
            await assertYellowWaitingIndicator(row.locator("[data-task-running-indicator]"), theme);
          }
          const title = row.locator('[data-task-title-copy="original"], p[title]').first();
          const before = await title.evaluate((el) => el.getBoundingClientRect().left);
          const actualRow =
            mode === "archived"
              ? row
              : row.locator('[data-task-item-key], [role="button"], .group\\/task-row').first();
          const height = await actualRow.evaluate((el) => el.getBoundingClientRect().height);
          assert.ok(
            (await icon.evaluate((el) => el.getBoundingClientRect().right)) <= before,
            "The icon sits before the title",
          );
          if (mode !== "overlay") {
            await actualRow.hover();
            assert.equal(await icon.isVisible(), true, "Hover keeps API identity");
            if (expected)
              assert.equal(
                await row.locator("[data-task-status-indicator]").isVisible(),
                true,
                "Hover keeps the status badge",
              );
            assert.equal(await title.evaluate((el) => el.getBoundingClientRect().left), before);
            assert.equal(
              await actualRow.evaluate((el) => el.getBoundingClientRect().height),
              height,
            );
            await page.mouse.move(width - 2, 2);
            if (mode !== "archived") await actualRow.focus();
            assert.equal(await icon.isVisible(), true, "Keyboard focus keeps API identity");
            assert.equal(await title.evaluate((el) => el.getBoundingClientRect().left), before);
            await page.evaluate(() => document.activeElement?.blur());
          }
        }
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        );
        if (width === 1280 && theme === "dark")
          await fixture.screenshot({ path: `/tmp/zcode-native-icons-${mode}.png` });
      }
      await page.evaluate(() => {
        window.__nativeIcons.mode("default");
        window.__nativeIcons.composer("custom-openai/GLM-5");
      });
      const idleIcon = page.getByTestId("task-item-idle").locator('[data-task-agent-icon="api"]');
      await idleIcon.waitFor();
      assert.equal(
        await idleIcon.getAttribute("data-task-provider-id"),
        "bigmodel-api",
        "Composer model changes do not change history icons",
      );
      await page.evaluate(() => window.__nativeIcons.model("custom-openai/GLM-5$high"));
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="task-item-idle"] [data-task-agent-icon]')?.dataset
            .taskProviderId === "custom-openai",
      );
      assert.equal(
        await idleIcon.locator("img").getAttribute("src"),
        await page.locator('[data-reference-provider="custom-openai"] img').getAttribute("src"),
      );
      assert.equal(
        await page
          .getByTestId("task-item-legacy")
          .locator("[data-task-agent-icon]")
          .getAttribute("data-task-provider-id"),
        "bigmodel-api",
        "Only the changed task updates its provider",
      );
      for (const model of [undefined, "invalid-legacy-model", "no-logo/GLM-5"]) {
        await page.evaluate((model) => window.__nativeIcons.model(model), model);
        await page.getByTestId("task-item-idle").locator("svg.lucide-package").waitFor();
      }
      await page.evaluate(() => {
        window.__nativeIcons.model("bigmodel-api/GLM-5");
        window.__nativeIcons.logo("anthropic");
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="task-item-idle"] [data-task-agent-icon] img')
          ?.src.includes("anthropic"),
      );
      assert.equal(await fixture.locator('[data-task-agent-icon="api"]').count(), 8);
      assert.equal(
        await page.evaluate(() => window.__nativeIcons.providerReads),
        1,
        "Local rows reuse one root read through all list modes and updates",
      );
      assert.deepEqual(
        await page.evaluate(() => window.__nativeIcons.calls),
        [],
        "Rendering icons never selects a task or invokes a mutation",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    "PASS: native API icons, legacy metadata, status precedence/live running, project/timeline/pinned/grouped/drag/archive, hover/focus, themes and narrow screens.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
