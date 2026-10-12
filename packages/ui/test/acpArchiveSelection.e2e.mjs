// Real ACP sidebar commands and selection hook, fake Host; no user history or model calls.
// Run with the desktop Vite server: node packages/ui/test/acpArchiveSelection.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-archive-selection-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAcpConversation} from '../../../ui/test/acpProjectionFixture.tsx';
      import {WorkspaceAcpTaskItem} from '../../../ui/src/WorkspaceAcpTaskItem.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
      import '../../../ui/src/styles.css';
      const store = new Map();
      const subscriptions = new Set();
      const calls = [];
      const closed = [];
      const controls = {calls, closed, store, subscriptions};
      window.__archiveClose = controls;
      const workspace = {workspacePath:'/fixture/archive', workspaceIdentity:'remote:one', remoteSessionId:'attachment:one'};
      const sameScope = (a,b) => a.workspacePath === b.workspacePath &&
        (a.workspaceIdentity?.trim() || a.workspacePath) === (b.workspaceIdentity?.trim() || b.workspacePath);
      const emit = session => {
        store.set(session.id, session);
        for (const {listener, target} of subscriptions) {
          if(sameScope(target, session)) listener({kind:'updated',session});
        }
        controls.publish();
      };
      controls.add = (id, agent='codex', archived=false, revision=1) => {
        const session = {...workspace, id, agent, title:'正文 '+id, archived, pinned:false,
          provisional:false, revision, status:'idle', entries:[], configOptions:[], modeState:null,
          createdAt:1, updatedAt:2};
        emit(session); return session;
      };
      controls.patch = (id, patch) => emit({...store.get(id), ...patch});
      controls.raw = session => {
        for(const {listener} of subscriptions) listener({kind:'updated',session});
      };
      const service = {
        onDynamicSessionChanged: target => listener => {
          const entry={target,listener}; subscriptions.add(entry);
          return {dispose:()=>subscriptions.delete(entry)};
        },
        list: async target => {
          const snapshot=[...store.values()].filter(s=>sameScope(target,s));
          if(controls.delayList) await new Promise(resolve=>{controls.releaseList=()=>{controls.delayList=false;resolve()}});
          return snapshot;
        },
        refresh: async ({id}) => {
          calls.push('refresh:'+id);
          const snapshot=store.get(id);
          if(controls.delayRefresh) await new Promise(resolve=>{controls.releaseRefresh=()=>{controls.delayRefresh=false;resolve()}});
          return snapshot;
        },
        create: async () => {calls.push('create'); throw new Error('Unexpected replacement connection')},
        remove: async () => {calls.push('remove'); throw new Error('Archive must preserve history')},
        updateRow: async input => {
          calls.push(input);
          if(controls.failArchive){controls.failArchive=false;throw new Error('Fake Host archive failed')}
          if(controls.delayArchive) await new Promise(resolve=>{controls.releaseArchive=()=>{controls.delayArchive=false;resolve()}});
          const current=store.get(input.id);
          emit({...current, archived:input.action.archived, pinned:false, revision:current.revision+1});
          return store.get(input.id);
        }
      };
      controls.publish=()=>{};
      function Fixture(){
        const [agent,setAgent]=useState(null);
        const [target,setTarget]=useState(workspace);
        const [rows,setRows]=useState([]);
        const conversation=useAcpConversation(service as never,target,agent,id=>{closed.push(id);setAgent(null)});
        controls.publish=()=>setRows([...store.values()]);
        controls.open=(id,archived=false)=>{
          conversation.selectById(store.get(id).agent,id,archived);
          setAgent(store.get(id).agent);
        };
        controls.target=setTarget;
        controls.retry=conversation.retryList;
        controls.nativeStore=useZCodeSessionStore;
        useEffect(()=>controls.publish(),[]);
        return <main>
          <header data-testid="selection" data-id={conversation.selected?.id??''} data-agent={agent??'api'}
            data-loaded={conversation.loaded} data-ready={conversation.ready&&!conversation.busy}>
            {conversation.selected?.title??'新建任务'}
          </header>
          <ul style={{width:300}}>{rows.filter(s=>sameScope(target,s)&&!s.archived).map(session=><WorkspaceAcpTaskItem
            key={session.id} session={session} service={service} active={conversation.selected?.id===session.id}
            variant="default" onSelect={()=>controls.open(session.id)}/>)}</ul>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false}}>
        <ServiceProvider services={{acpService:service}}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
          <Fixture/>
        </TooltipProvider></ZCodeIntlProvider></ServiceProvider>
      </PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const load = async () => {
    await page.goto(`${origin}/${name}.html`);
    await page.getByTestId("selection").waitFor();
  };
  const state = page.getByTestId("selection");
  const selected = async (id) =>
    page.waitForFunction(
      (id) => document.querySelector('[data-testid="selection"]')?.dataset.id === id,
      id,
    );
  const open = async (id, archived = false) => {
    await page.evaluate(
      ([id, archived]) => window.__archiveClose.open(id, archived),
      [id, archived],
    );
    await selected(id);
  };
  const add = async (id, agent = "codex", archived = false, revision = 1) =>
    page.evaluate((args) => window.__archiveClose.add(...args), [id, agent, archived, revision]);
  const inlineArchive = async (id) => {
    const row = page.getByTestId(`acp-task-item-${id}`);
    await row.hover();
    const button = row.getByTestId(`acp-task-archive-${id}`);
    await button.click();
    await button.click();
  };
  const closed = async () => page.evaluate(() => [...window.__archiveClose.closed]);

  await load();
  await add("current");
  await open("current");
  await inlineArchive("current");
  await selected("");
  assert.equal(await state.getAttribute("data-agent"), "api");
  assert.equal(await state.innerText(), "新建任务");
  assert.deepEqual(await closed(), ["current"]);
  assert.equal(await page.getByTestId("acp-task-item-current").count(), 0);
  assert.equal(await page.evaluate(() => window.__archiveClose.store.has("current")), true);
  assert.equal(
    await page.evaluate(
      () =>
        window.__archiveClose.calls.includes("create") ||
        window.__archiveClose.calls.includes("remove"),
    ),
    false,
  );

  // Failure retains the view; the context-menu command uses the same confirmed closure.
  await add("failure");
  await open("failure");
  await page.evaluate(() => {
    window.__archiveClose.failArchive = true;
  });
  await inlineArchive("failure");
  await page.waitForFunction(
    () => window.__archiveClose.calls.filter((call) => call.id === "failure").length === 1,
  );
  assert.equal(await state.getAttribute("data-id"), "failure");
  assert.deepEqual(await closed(), ["current"]);
  await page.getByTestId("acp-task-item-failure").click({ button: "right" });
  await page
    .getByTestId("acp-task-menu-failure")
    .getByRole("menuitem", { name: "归档任务", exact: true })
    .click();
  await selected("");
  assert.deepEqual(await closed(), ["current", "failure"]);

  // Archive admission finishes after an explicit switch: the new exact id wins.
  await add("old");
  await add("new");
  await add("background", "claude");
  await open("old");
  await page.evaluate(() => {
    window.__archiveClose.delayArchive = true;
  });
  await inlineArchive("old");
  await page.waitForFunction(() => typeof window.__archiveClose.releaseArchive === "function");
  await open("new");
  await page.evaluate(() => window.__archiveClose.releaseArchive());
  await page.getByTestId("acp-task-item-old").waitFor({ state: "detached" });
  await page.evaluate(() =>
    window.__archiveClose.patch("background", { archived: true, revision: 2 }),
  );
  assert.equal(await state.getAttribute("data-id"), "new");
  assert.deepEqual(await closed(), ["current", "failure"]);

  // Cross-Agent open and the previous Agent's archive can arrive in the same batch.
  await add("cross-agent", "claude");
  await page.evaluate(() => {
    const fixture = window.__archiveClose;
    fixture.open("cross-agent");
    fixture.patch("new", { archived: true, revision: 2 });
  });
  await page.getByTestId("acp-task-item-new").waitFor({ state: "detached" });
  await selected("cross-agent");
  assert.deepEqual(await closed(), ["current", "failure"]);

  // Deliberately opened archived history survives duplicate and older snapshots.
  await open("old", true);
  await page.evaluate(() => {
    const fixture = window.__archiveClose;
    fixture.raw({ ...fixture.store.get("old"), archived: false, revision: 1 });
    fixture.raw(fixture.store.get("old"));
  });
  assert.equal(await state.getAttribute("data-id"), "old");
  await page.evaluate(() => window.__archiveClose.patch("old", { archived: false, revision: 3 }));
  await page.evaluate(() => window.__archiveClose.patch("old", { archived: true, revision: 4 }));
  await selected("");
  assert.deepEqual(await closed(), ["current", "failure", "old"]);

  // Lower archive revisions and a misrouted same-path/different-identity event cannot close it.
  await add("scoped", "codex", false, 10);
  await open("scoped");
  await page.evaluate(() => {
    const fixture = window.__archiveClose,
      session = fixture.store.get("scoped");
    fixture.raw({ ...session, archived: true, revision: 9 });
    fixture.raw({ ...session, archived: true, revision: 99, workspaceIdentity: "remote:other" });
  });
  assert.equal(await state.getAttribute("data-id"), "scoped");
  assert.equal(await state.innerText(), "正文 scoped");

  // A refresh captured before archive must not restore the selected id.
  await add("refresh");
  await page.evaluate(() => {
    window.__archiveClose.delayRefresh = true;
  });
  await open("refresh");
  await page.waitForFunction(() => typeof window.__archiveClose.releaseRefresh === "function");
  await page.evaluate(() =>
    window.__archiveClose.patch("refresh", { archived: true, revision: 2 }),
  );
  await selected("");
  await page.evaluate(() => window.__archiveClose.releaseRefresh());
  await selected("");

  // A refresh snapshot can also confirm archive when the live notification was unavailable.
  await add("refresh-only");
  await page.evaluate(() => {
    const fixture = window.__archiveClose;
    fixture.store.set("refresh-only", {
      ...fixture.store.get("refresh-only"),
      archived: true,
      revision: 2,
    });
    fixture.open("refresh-only");
  });
  await page.waitForFunction(() => window.__archiveClose.closed.includes("refresh-only"));
  await selected("");

  // Replay before list resolves, then an older list response: no history resurrection.
  await load();
  await add("list");
  await page.evaluate(() => {
    window.__archiveClose.delayList = true;
    window.__archiveClose.open("list");
  });
  await page.waitForFunction(() => typeof window.__archiveClose.releaseList === "function");
  await page.evaluate(() => window.__archiveClose.patch("list", { archived: true, revision: 2 }));
  await selected("");
  await page.evaluate(() => window.__archiveClose.releaseList());
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection"]')?.dataset.loaded === "true",
  );
  assert.equal(await state.getAttribute("data-agent"), "api");
  assert.deepEqual(await closed(), ["list"]);
  await page.evaluate(() => window.__archiveClose.raw(window.__archiveClose.store.get("list")));
  assert.deepEqual(await closed(), ["list"], "Repeated archive is idempotent");

  // A normal open whose first authoritative list is archived closes; archived-list intent opens.
  await load();
  await add("replay", "codex", true);
  await page.evaluate(() => window.__archiveClose.open("replay"));
  await page.waitForFunction(() => window.__archiveClose.closed.includes("replay"));
  await selected("");
  await open("replay", true);
  await page.evaluate(() => window.__archiveClose.retry());
  await selected("replay");

  // Old attachment subscription cannot close a selection preserved through reconnect.
  await page.evaluate(() => {
    const fixture = window.__archiveClose;
    fixture.oldListener = [...fixture.subscriptions][0].listener;
    fixture.target({ ...fixture.store.get("replay"), remoteSessionId: "attachment:two" });
  });
  await page.waitForFunction(() =>
    [...window.__archiveClose.subscriptions].some(
      (entry) => entry.target.remoteSessionId === "attachment:two",
    ),
  );
  await selected("replay");
  await page.evaluate(() => {
    const fixture = window.__archiveClose;
    fixture.oldListener({
      kind: "updated",
      session: { ...fixture.store.get("replay"), archived: true, revision: 100 },
    });
  });
  assert.equal(await state.getAttribute("data-id"), "replay");
  assert.equal(
    await page.evaluate(
      () =>
        window.__archiveClose.calls.includes("create") ||
        window.__archiveClose.calls.includes("remove"),
    ),
    false,
  );
  const native = await page.evaluate(() => {
    const store = window.__archiveClose.nativeStore;
    const path = "/fixture/native",
      identity = "remote:native";
    store.getState().setActiveTaskId(path, "native-current", identity);
    store.getState().removeTaskState(path, "native-background", identity);
    const background = store.getState().getWorkspaceState(path, identity).activeTaskId;
    store.getState().removeTaskState(path, "native-current", "remote:another");
    const anotherHost = store.getState().getWorkspaceState(path, identity).activeTaskId;
    store.getState().removeTaskState(path, "native-current", identity);
    return {
      background,
      anotherHost,
      selected: store.getState().getWorkspaceState(path, identity).activeTaskId,
    };
  });
  assert.deepEqual(native, {
    background: "native-current",
    anotherHost: "native-current",
    selected: null,
  });
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: inline/menu archive closure, failure, background/switch, archived reopen, revision/scope/attachment guards, delayed list/refresh; history preserved and no replacement connection.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
