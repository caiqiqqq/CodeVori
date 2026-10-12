// Real archive list, discovery hooks and confirmation dialog with an isolated Host fixture.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__conversation-archive-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ConversationArchiveSection} from '../../../ui/src/settings/ConversationArchiveSection.tsx';
    import {createSettingsPageConfig} from '../../../ui/src/settings/settingsPageConfig.ts';
    import {consumeInitialSettingsSection,writeLastSettingsSectionPreference} from '../../../ui/src/lib/settingsNavigation.ts';
    import {useWorktreeSettingsConversation} from '../../../ui/src/hooks/useWorktreeSettingsConversation.ts';
    import {useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {requestWorktreeSettingsConversation} from '../../../ui/src/lib/worktreeSettingsNavigation.ts';
    import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {ConfirmDialogHost} from '../../../ui/src/ConfirmDialog.tsx';
    import '../../../ui/src/styles.css';
    const workspacePath='/fixture/closed-project';
    const native=['native-restore','native-delete','native-pending','native-offline'].map((taskId,index)=>({taskId,traceId:taskId,title:taskId,workspacePath,mode:'build',createdAt:1,updatedAt:10-index,...(taskId==='native-pending'?{deletionState:'pending'}:{}),...(taskId==='native-offline'?{workspaceIdentity:'remote:offline',sourceAvailability:'offline'}:{})}));
    const acp=['acp-restore','acp-delete','acp-failed'].map((id,index)=>({id,title:id,agent:'codex',workspacePath,archived:true,pinned:false,status:'idle',revision:1,createdAt:1,updatedAt:20-index,entries:[{id:'user:'+id,kind:'user',text:'saved history',createdAt:1}]}));
    const controllerListeners=new Set(); const nativeChanged=()=>controllerListeners.forEach(l=>l({subscriptionId:"fixture",topic:"controller/tasks-index",logEpoch:"fixture",toSeq:1,payload:{kind:"snapshot",snapshot:{tasks:[]}}})); const listeners=new Set(); const calls=[]; const navigation=[]; const controls={calls,native,acp,navigation,fail:false,skip:false}; window.__archive=controls;
    const service={
      listArchivedWorkspaces:async()=>[{workspacePath}], list:async()=>acp,
      onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
      updateRow:async({id})=>{calls.push('restore:'+id);const session=acp.find(s=>s.id===id);session.archived=false;session.revision++;listeners.forEach(l=>l({kind:'updated',session:{...session}}))},
      removeArchived:async({id})=>{calls.push('purge:'+id);if(controls.fail)throw new Error('fixture cleanup failure');if(controls.skip)return false;acp.splice(acp.findIndex(s=>s.id===id),1);listeners.forEach(l=>l({kind:'removed',id,workspaceKey:workspacePath,workspacePath}));return true},
      create:async()=>{throw new Error('Archive must not create a conversation')},
    };
    const services={acpService:service,zcodeTaskService:{
      listArchivedWorkspaces:async()=>[{workspacePath}],
      unarchiveTask:async({taskId})=>{calls.push('restore:'+taskId);native.splice(native.findIndex(t=>t.taskId===taskId),1);nativeChanged()},
      deleteArchivedTask:async({taskId})=>{calls.push('purge:'+taskId);if(controls.skip)return false;native.splice(native.findIndex(t=>t.taskId===taskId),1);nativeChanged();return true},
      deleteTask:async()=>{throw new Error('Soft deletion is forbidden in archive center')},
    },windowControllerService:{
      onDynamicControllerFrame:()=>listener=>{controllerListeners.add(listener);return {dispose:()=>controllerListeners.delete(listener)}},
      subscribeControllerV4:async({topic})=>({ack:{subscriptionId:topic}}), unsubscribeControllerV4:async()=>{},
      listTaskList:async({workspaceScopes})=>{controls.scopes=workspaceScopes;return {items:native.filter(t=>workspaceScopes.some(s=>s.workspacePath===t.workspacePath)),total:native.length,hasMore:false}},
    }};
    function Fixture(){
      const [section,setSection]=React.useState('general');
      controls.tabs=useTabStoreApi(); controls.navigate=requestWorktreeSettingsConversation;
      useWorktreeSettingsConversation({selectApi:(path,id,identity)=>{calls.push('select:'+id);navigation.push({kind:'api',path,id,identity})},selectAcp:s=>{calls.push('select:'+s.id);navigation.push({kind:'acp',path:s.workspacePath,id:s.id,identity:s.workspaceIdentity})},openWorkTasks:()=>{throw new Error('Archive must not infer work task ownership')}});
      const entries=createSettingsPageConfig().settingsSectionGroups.find(g=>g.id==='dataAndStats').sections;
      return <><nav aria-label="设置菜单">{entries.map(entry=><button key={entry.id} onClick={()=>{writeLastSettingsSectionPreference(entry.id);setSection(consumeInitialSettingsSection())}}>{entry.id==='conversationArchive'?'已归档对话':'使用统计'}</button>)}</nav><main data-section={section} style={{maxWidth:600}}>{section==='conversationArchive'?<ConversationArchiveSection/>:null}</main></>;
    }
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isWindows:false,isLinux:true} as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/><ConfirmDialogHost/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);

  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/${name}.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      const row = (id) =>
        page.getByTestId(`archived-${id.startsWith("acp") ? "acp" : "native"}-task-${id}`);
      await page.getByRole("button", { name: "已归档对话", exact: true }).click();
      await page.locator('main[data-section="conversationArchive"]').waitFor();
      await row("native-delete").waitFor();
      await row("acp-delete").waitFor();
      await page.getByRole("button", { name: "更新时间", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "创建时间", exact: true }).click();
      await page.getByRole("button", { name: "创建时间", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "更新时间", exact: true }).click();
      assert.equal(await page.getByTestId("archived-tasks-actions").count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__archive.scopes), [
        { workspacePath: "/fixture/closed-project" },
      ]);
      await row("native-restore").focus();
      await page.keyboard.press("Enter");
      assert.ok(
        (await page.evaluate(() => window.__archive.calls)).includes("select:native-restore"),
      );
      assert.equal(
        await row("native-pending")
          .getByRole("button", { name: "恢复对话", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await row("native-offline")
          .getByRole("button", { name: "彻底删除", exact: true })
          .isDisabled(),
        true,
      );
      await row("native-delete").getByRole("button", { name: "彻底删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^取消/ })
        .click();
      assert.ok(
        !(await page.evaluate(() => window.__archive.calls)).includes("purge:native-delete"),
      );
      await row("native-delete").getByRole("button", { name: "彻底删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^彻底删除/ })
        .click();
      await row("native-delete").waitFor({ state: "detached" });
      await row("acp-restore").getByRole("button", { name: "恢复对话", exact: true }).click();
      await row("acp-restore").waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(
          () => window.__archive.acp.find((s) => s.id === "acp-restore").entries[0].text,
        ),
        "saved history",
      );
      await page.evaluate(() => (window.__archive.fail = true));
      await row("acp-failed").getByRole("button", { name: "彻底删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^彻底删除/ })
        .click();
      await row("acp-failed").getByRole("button", { name: "彻底删除", exact: true }).waitFor();
      assert.equal(await row("acp-failed").count(), 1);
      await page.evaluate(() => (window.__archive.fail = false));
      await row("acp-delete").getByRole("button", { name: "彻底删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^彻底删除/ })
        .click();
      await row("acp-delete").waitFor({ state: "detached" });
      const navigation = await page.evaluate(() => {
        const c = window.__archive;
        const path = "/fixture/same-path";
        c.tabs.getState().addTab(path);
        c.tabs
          .getState()
          .addTab(path, { workspaceIdentity: "remote:connected", remoteSessionId: "fixture-host" });
        c.navigate({
          kind: "api",
          workspacePath: path,
          workspaceIdentity: "remote:connected",
          taskId: "remote-api",
        });
        const api = {
          target: c.navigation.at(-1),
          identity: c.tabs.getState().activeWorkspaceIdentity,
        };
        c.navigate({
          kind: "acp",
          session: {
            id: "remote-acp",
            agent: "codex",
            workspacePath: path,
            workspaceIdentity: "remote:connected",
            remoteSessionId: "fixture-host",
          },
        });
        const acp = {
          target: c.navigation.at(-1),
          identity: c.tabs.getState().activeWorkspaceIdentity,
        };
        const count = c.tabs.getState().tabs.length;
        const selected = c.navigation.length;
        c.navigate({
          kind: "api",
          workspacePath: "/fixture/disconnected",
          workspaceIdentity: "remote:missing",
          taskId: "missing-api",
        });
        c.navigate({
          kind: "acp",
          session: {
            id: "missing-acp",
            agent: "codex",
            workspacePath: "/fixture/disconnected",
            workspaceIdentity: "remote:missing",
          },
        });
        return {
          api,
          acp,
          tabCountUnchanged: count === c.tabs.getState().tabs.length,
          selectionUnchanged: selected === c.navigation.length,
        };
      });
      assert.equal(navigation.api.identity, "remote:connected");
      assert.equal(navigation.api.target.identity, "remote:connected");
      assert.equal(navigation.api.target.id, "remote-api");
      assert.equal(navigation.acp.identity, "remote:connected");
      assert.equal(navigation.acp.target.id, "remote-acp");
      assert.equal(navigation.tabCountUnchanged, true);
      assert.equal(navigation.selectionUnchanged, true);
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.close();
    }
  process.stdout.write(
    "PASS: settings archive menu, owning conversation navigation, archive discovery with no open tabs, preserved restore history, permanent native/ACP delete, cancel/failure/offline/pending and keyboard in desktop/mobile widths and both themes.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
