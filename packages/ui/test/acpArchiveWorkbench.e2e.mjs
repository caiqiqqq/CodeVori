// Test the real workbench/layout owners at the SessionPane event boundary.
// SessionPane and its transport provider are stubbed; no real Host or user history is touched.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-archive-workbench-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {V4WorkspaceChatArea} from '../../../ui/src/v4/V4WorkspaceChatArea.tsx';
      import {usePaneLayoutStore, V4_PRIMARY_PANE_ID} from '../../../ui/src/v4/paneLayoutStore.ts';
      import {useWorkbenchGroupStore} from '../../../ui/src/v4/workbenchGroupStore.ts';
      window.__React=React;
      const scope={workspacePath:'/fixture/workbench',workspaceIdentity:'remote:workbench',remoteSessionId:'attachment:workbench'};
      const primary={workspaceScope:scope,sessionId:'native-primary'};
      const acp={workspaceScope:scope,sessionId:'acp-history',kind:'acp',agent:'codex'};
      const events={archives:[],nativeSelections:[],nativeDeletes:0};
      window.__workbench={scope,primary,acp,events,panes:usePaneLayoutStore,groups:useWorkbenchGroupStore};
      createRoot(document.getElementById('root')).render(<div style={{height:500,width:900}}><V4WorkspaceChatArea
        {...scope} sessionId="native-primary" onPrimaryAcpSessionArchived={id=>events.archives.push(id)}
        onPaneActiveSessionChange={(scope,id)=>events.nativeSelections.push({scope,id})}
        onSessionDeleted={()=>events.nativeDeletes++}/></div>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/packages/ui/src/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      export function SessionPane(props) {
        return window.__React.createElement('button', {
          'data-testid':'archive-boundary-'+props.paneId,
          'data-session':props.acpBoundSessionId??props.sessionId??'',
          onClick:()=>props.onAcpSessionArchived?.(window.__archiveId??props.acpBoundSessionId)
        }, 'Host archive confirmed');
      }
    `,
    }),
  );
  await page.route("**/packages/ui/src/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function V4PaneConversationProvider({children}) {return children}",
    }),
  );
  await page.goto(`${origin}/${name}.html`);
  await page.getByTestId("archive-boundary-workspace-main").waitFor();
  const snapshot = async () =>
    page.evaluate(() => {
      const { panes, groups, events } = window.__workbench;
      return {
        panes: panes.getState().panes,
        groups: groups.getState().groups,
        index: groups.getState().sessionIndex,
        active: groups.getState().activeGroupId,
        events,
      };
    });
  const archive = async (paneId) => page.getByTestId(`archive-boundary-${paneId}`).click();

  // Draft-layout secondary ACP closes through the layout owner, without native deletion.
  await page.evaluate(() => {
    const { panes, acp } = window.__workbench;
    panes.getState().splitPaneWithBinding("workspace-main", "right", acp);
  });
  let paneId = Object.keys((await snapshot()).panes)[0];
  await page.getByTestId(`archive-boundary-${paneId}`).waitFor();
  await page.evaluate(() => {
    window.__archiveId = "different-session";
  });
  await archive(paneId);
  assert.equal(
    Object.keys((await snapshot()).panes).length,
    1,
    "Other conversation cannot close this binding",
  );
  await page.evaluate(() => {
    window.__archiveId = null;
  });
  await archive(paneId);
  await page.getByTestId(`archive-boundary-${paneId}`).waitFor({ state: "detached" });
  assert.deepEqual((await snapshot()).panes, {});
  assert.equal(
    await page.getByTestId("archive-boundary-workspace-main").getAttribute("data-session"),
    "native-primary",
  );

  // Three-pane group: remove only ACP, retain both native bindings and their group.
  await page.evaluate(() => {
    const { groups, acp, primary, scope } = window.__workbench;
    groups.getState().splitSessionIntoGroup("workspace-main", "right", acp, primary);
    groups.getState().splitSessionIntoGroup("workspace-main", "down", {
      workspaceScope: scope,
      sessionId: "native-other",
    });
  });
  let group = Object.values((await snapshot()).groups)[0];
  paneId = Object.entries(group.panes).find(([, binding]) => binding.kind === "acp")[0];
  await page.getByTestId(`archive-boundary-${paneId}`).waitFor();
  await archive(paneId);
  await page.getByTestId(`archive-boundary-${paneId}`).waitFor({ state: "detached" });
  group = Object.values((await snapshot()).groups)[0];
  assert.equal(group.primaryBinding.sessionId, "native-primary");
  assert.deepEqual(
    Object.values(group.panes).map((binding) => binding.sessionId),
    ["native-other"],
  );
  assert.equal(
    Object.keys((await snapshot()).index).some((key) => key.includes("acp-history")),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      Object.values(
        JSON.parse(localStorage.getItem("zcode-v4-session-workbench-groups:v1")).groups,
      ).some((group) => Object.values(group.panes).some((binding) => binding.kind === "acp")),
    ),
    false,
  );

  // Primary ACP archive removes only that pane and notifies the matching shell.
  await page.evaluate(() => {
    const { groups, acp, primary } = window.__workbench;
    groups.getState().resetWorkbenchGroups();
    groups.getState().splitSessionIntoGroup("workspace-main", "right", primary, acp);
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="archive-boundary-workspace-main"]')?.dataset.session ===
      "acp-history",
  );
  await archive("workspace-main");
  await page.getByTestId("archive-boundary-workspace-main").waitFor({ state: "detached" });
  group = Object.values((await snapshot()).groups)[0];
  assert.equal(group.primaryBinding, null);
  assert.deepEqual(
    Object.values(group.panes).map((binding) => binding.sessionId),
    ["native-primary"],
  );
  assert.deepEqual((await snapshot()).events.archives, [
    "acp-history",
    "acp-history",
    "acp-history",
  ]);
  assert.equal((await snapshot()).events.nativeDeletes, 0);
  assert.equal(
    (await snapshot()).events.nativeSelections.some((event) => event.id === "acp-history"),
    false,
  );

  // Same path/id on a different identity belongs to that pane, not the current shell.
  await page.evaluate(() => {
    const { groups, acp, primary } = window.__workbench;
    groups.getState().resetWorkbenchGroups();
    const other = {
      ...acp,
      workspaceScope: {
        ...acp.workspaceScope,
        workspaceIdentity: "remote:another",
        remoteSessionId: "attachment:another",
      },
    };
    groups.getState().splitSessionIntoGroup("workspace-main", "right", primary, other);
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="archive-boundary-workspace-main"]')?.dataset.session ===
      "acp-history",
  );
  await archive("workspace-main");
  await page.getByTestId("archive-boundary-workspace-main").waitFor({ state: "detached" });
  group = Object.values((await snapshot()).groups)[0];
  assert.equal(group.primaryBinding, null);
  assert.deepEqual(
    Object.values(group.panes).map((binding) => binding.sessionId),
    ["native-primary"],
  );
  assert.deepEqual((await snapshot()).events.archives, [
    "acp-history",
    "acp-history",
    "acp-history",
  ]);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: real workbench closes exact ACP split binding, preserves other panes including single-pane groups, persists cleanup and isolates workspace identity/native routing.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
