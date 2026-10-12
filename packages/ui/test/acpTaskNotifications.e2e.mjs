// pnpm exec tsx packages/ui/test/acpTaskNotifications.e2e.mjs
// Production hook + settings + audio gate, captured platform, no Agent/model requests.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__acp-notifications-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let server;
let browser;
try {
  await writeFile(html, `<div id="root"></div><script type="module" src="./${name}.tsx"></script>`);
  await writeFile(
    moduleFile,
    `import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
    import {useAcpTaskNotifications} from '../../../ui/src/hooks/useAcpTaskNotifications.ts';
    import {createZCodeStore} from '../../../ui/src/store/index.ts';
    import {playTaskNotificationSound} from '../../../ui/src/lib/taskNotificationSound.ts';
    import {listenWorktreeSettingsConversation, consumeWorktreeSettingsConversation} from '../../../ui/src/lib/worktreeSettingsNavigation.ts';
    import zh from '../../../ui/src/i18n/locales/zh-CN.ts';
    const useZCodeStore=createZCodeStore({onMessage(){return {dispose(){}}},send(){}} as never);
    const notifications=[], navigations=[], listeners=[], clicks=new Set(), reads=[];
    let audioPlays=0, mutedByFocus=false;
    window.Audio=class {pause(){} play(){audioPlays++;return Promise.resolve()}} as never;
    const platform={showTaskNotification(payload){
      if(mutedByFocus) return;
      notifications.push(payload); void playTaskNotificationSound();
    },onTaskNotificationClick(fn){clicks.add(fn);return ()=>clicks.delete(fn)}};
    const acpService={onDynamicSessionChanged(workspace){return fn=>{
      const item={workspace,fn,live:true};listeners.push(item);
      return {dispose(){item.live=false}};
    }},list(workspace){return new Promise(resolve=>reads.push({workspace,resolve}))}};
    listenWorktreeSettingsConversation(target=>{navigations.push(target);consumeWorktreeSettingsConversation(target)});
    useZCodeStore.getState().setNotificationEnabled(true);
    useZCodeStore.getState().setNotificationSoundEnabled(true);
    function Fixture(){
      const [scope,setScope]=useState({workspacePath:'/fixture',workspaceIdentity:'remote:one',remoteSessionId:'attachment:one'});
      const [rpcReady,setReady]=useState(true);
      const [epoch,setEpoch]=useState(0);
      const enabled=useZCodeStore(s=>s.notificationEnabled);
      const sound=useZCodeStore(s=>s.notificationSoundEnabled);
      window.__fixture={notifications,navigations,listeners,reads,
        emit(snapshot,index=listeners.findLastIndex(item=>item.live)){
          listeners[index].fn({kind:'updated',session:{...scope,...snapshot}});
        },remove(id){listeners.findLast(item=>item.live).fn({kind:'removed',id,workspaceKey:scope.workspaceIdentity,workspacePath:scope.workspacePath})},
        baseline(items,index=reads.length-1){reads[index].resolve(items.map(item=>({...reads[index].workspace,...item})))},
        click(id){for(const fn of clicks)fn(id)},
        setScope,setReady,remount(){setEpoch(e=>e+1)},
        focus(value){mutedByFocus=value},get audioPlays(){return audioPlays},
        get liveCount(){return listeners.filter(item=>item.live).length}
      };
      return <><button id="notifications" onClick={()=>useZCodeStore.getState().setNotificationEnabled(!enabled)}>Notifications {String(enabled)}</button>
        <button id="sound" disabled={!enabled} onClick={()=>useZCodeStore.getState().setNotificationSoundEnabled(!sound)}>Sound {String(sound)}</button>
        <Observer key={epoch} scope={scope} enabled={enabled} rpcReady={rpcReady}/></>;
    }
    function Observer({scope,enabled,rpcReady}){
      useAcpTaskNotifications({...scope,enabled,rpcReady,platform,formatMessage:({id},values)=>
        (zh[id]??id).replace('{title}',values?.title??'')});
      return <span id="ready">ready</span>;
    }
    createRoot(document.getElementById('root')!).render(<React.StrictMode><ServiceProvider services={{acpService} as never}><Fixture/></ServiceProvider></React.StrictMode>);`,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  const snapshot = (patch = {}) => ({
    id: "one",
    agent: "codex",
    acpSessionId: "native",
    title: "后台 ACP 任务",
    status: "running",
    revision: 1,
    archived: false,
    error: null,
    queue: { items: [], autoDrain: true },
    entries: [{ id: "user:one", kind: "user", text: "work", createdAt: 1 }],
    ...patch,
  });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/${name}.html`);
    await page.waitForFunction(() => window.__fixture?.liveCount === 1);
    const emit = (item, index) =>
      page.evaluate(({ item, index }) => window.__fixture.emit(item, index), { item, index });
    const count = () => page.evaluate(() => window.__fixture.notifications.length);
    // First live/history snapshots are baselines. Another Agent's live turn is observed too.
    await page.evaluate((item) => window.__fixture.baseline([item]), snapshot({ status: "idle" }));
    assert.equal(await count(), 0);
    await emit(snapshot({ revision: 2, agent: "gemini" }));
    await emit(snapshot({ status: "idle", revision: 3, agent: "gemini" }));
    assert.equal(await count(), 1);
    assert.equal(await page.evaluate(() => window.__fixture.audioPlays), 1);
    const payload = await page.evaluate(() => window.__fixture.notifications[0]);
    assert.equal(payload.taskId, "acp:one");
    assert.equal(payload.status, "completed");
    assert.ok(payload.body.includes("后台 ACP 任务"));
    await emit(snapshot({ status: "idle", revision: 3 }));
    await emit(snapshot({ status: "idle", revision: 2 }));
    assert.equal(await count(), 1);
    await page.evaluate(() => window.__fixture.click("acp:one"));
    const navigation = await page.evaluate(() => window.__fixture.navigations[0]);
    assert.equal(navigation.kind, "acp");
    assert.equal(navigation.session.workspaceIdentity, "remote:one");
    assert.equal(navigation.session.remoteSessionId, "attachment:one");
    assert.equal(navigation.session.agent, "gemini");
    // Real sound preference keeps the banner, but blocks audio.
    await page.locator("#sound").click();
    await emit(snapshot({ revision: 4 }));
    await emit(snapshot({ status: "interrupted", revision: 5, error: "failed" }));
    assert.equal(await count(), 2);
    assert.equal(await page.evaluate(() => window.__fixture.notifications.at(-1).status), "failed");
    assert.equal(await page.evaluate(() => window.__fixture.audioPlays), 1);
    // Explicit stop and platform focus suppression do not show completion.
    await emit(snapshot({ revision: 6 }));
    await emit(
      snapshot({
        status: "idle",
        revision: 7,
        queue: { items: [], autoDrain: false, pauseReason: "stopped" },
      }),
    );
    assert.equal(await count(), 2);
    await page.evaluate(() => window.__fixture.focus(true));
    await emit(snapshot({ revision: 8 }));
    await emit(snapshot({ status: "idle", revision: 9 }));
    assert.equal(await count(), 2);
    await page.evaluate(() => window.__fixture.focus(false));
    // Disabled listeners and their late callbacks cannot notify.
    const oldIndex = await page.evaluate(() =>
      window.__fixture.listeners.findLastIndex((item) => item.live),
    );
    await page.locator("#notifications").click();
    await page.waitForFunction(() => window.__fixture.liveCount === 0);
    await emit(snapshot({ revision: 10 }), oldIndex);
    await emit(snapshot({ status: "idle", revision: 11 }), oldIndex);
    assert.equal(await count(), 2);
    assert.equal(await page.locator("#sound").isDisabled(), true);
    await page.locator("#notifications").click();
    await page.waitForFunction(() => window.__fixture.liveCount === 1);
    await page.evaluate(
      (item) => window.__fixture.baseline([item]),
      snapshot({ status: "idle", revision: 11 }),
    );
    assert.equal(await count(), 2);
    // Change identity/attachment at the same path; old running/list/events are invalid.
    const previousIndex = await page.evaluate(() =>
      window.__fixture.listeners.findLastIndex((item) => item.live),
    );
    await page.evaluate(() =>
      window.__fixture.setScope({
        workspacePath: "/fixture",
        workspaceIdentity: "remote:two",
        remoteSessionId: "attachment:two",
      }),
    );
    await page.waitForFunction(
      () =>
        window.__fixture.listeners.findLast((item) => item.live)?.workspace.remoteSessionId ===
        "attachment:two",
    );
    await emit(snapshot({ status: "idle", revision: 12 }), previousIndex);
    await emit(snapshot({ revision: 12, workspaceIdentity: "remote:one" }));
    await emit(snapshot({ status: "idle", revision: 13, workspaceIdentity: "remote:one" }));
    assert.equal(await count(), 2);
    // Live edge before list resolves survives a stale list and cannot be repeated.
    await emit(snapshot({ revision: 12 }));
    await emit(snapshot({ status: "idle", revision: 13 }));
    assert.equal(await count(), 3);
    await page.evaluate((item) => window.__fixture.baseline([item]), snapshot({ revision: 12 }));
    await emit(snapshot({ status: "idle", revision: 13 }));
    assert.equal(await count(), 3);
    await page.evaluate(() => window.__fixture.click("acp:one"));
    assert.equal(
      await page.evaluate(() => window.__fixture.navigations.at(-1).session.remoteSessionId),
      "attachment:two",
    );
    // Deletion tombstone blocks stale updates and clicks.
    await page.evaluate(() => window.__fixture.remove("one"));
    await emit(snapshot({ revision: 14 }));
    await emit(snapshot({ status: "idle", revision: 15 }));
    await page.evaluate(() => window.__fixture.click("acp:one"));
    assert.equal(await page.evaluate(() => window.__fixture.navigations.length), 2);
    assert.equal(await count(), 3);
    // Disconnect/reconnect and remount establish a fresh replay baseline.
    await page.evaluate(() => window.__fixture.setReady(false));
    await page.waitForFunction(() => window.__fixture.liveCount === 0);
    await page.evaluate(() => window.__fixture.setReady(true));
    await page.waitForFunction(() => window.__fixture.liveCount === 1);
    await page.evaluate(
      (item) => window.__fixture.baseline([item]),
      snapshot({ status: "idle", revision: 15 }),
    );
    const listenerCount = await page.evaluate(() => {
      window.__fixture.remount();
      return window.__fixture.listeners.length;
    });
    await page.waitForFunction(
      (previousCount) =>
        window.__fixture.liveCount === 1 && window.__fixture.listeners.length > previousCount,
      listenerCount,
    );
    await emit(snapshot({ status: "idle", revision: 15 }));
    assert.equal(await count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: ACP notification lifecycle/settings/sound/navigation at desktop and mobile widths\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
