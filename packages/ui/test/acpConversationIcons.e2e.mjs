// Real ACP sidebar rows, fake Host projections; no model calls or real history mutations.
// Run against desktop Vite: node packages/ui/test/acpConversationIcons.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { assertYellowWaitingIndicator } from "./waitingResponseIndicatorAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-conversation-icons-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ACP_AGENT_CATALOG} from '@zcode/shared';
      import {WorkspaceAcpTaskItem} from '../../../ui/src/WorkspaceAcpTaskItem.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
      const initial=ACP_AGENT_CATALOG.map(({id},i)=>({
        id:'session-'+i, agent:id, title:'对话 '+i+(i===2?' 标题很长但不应该挤压智能体图标和工作树标记'.repeat(5):''),
        workspacePath:i===1?'/fixture/worktrees/ab12/repo':'/fixture/repo',
        ...(i===14?{workspaceIdentity:'remote:fixture',remoteSessionId:'attachment-fixture'}:{}),
        status:'ready',pinned:false,createdAt:Date.now()-i*10000,updatedAt:Date.now()-i*10000
      }));
      const state={catalog:ACP_AGENT_CATALOG,calls:[],selections:[]};
      window.__conversationIcons=state;
      const service=new Proxy({
        async updateRow(input){
          state.calls.push(input);
          if(state.failNext){state.failNext=false;throw new Error('Fixture Host mutation failed')}
          if(state.holdNext){state.holdNext=false;await new Promise(resolve=>{state.release=resolve})}
          const action=input.action;
          state.patch(input.id,action.kind==='pin'?{pinned:action.pinned}:action.kind==='archive'?{archived:action.archived,pinned:false}:action.kind==='unread'?{unreadAt:action.unread?Date.now():null}:{});
        }
      },{get(target,key){if(key in target)return target[key];return ()=>{throw new Error('Unexpected Host call: '+String(key))}}});
      function Fixture(){
        const tabs=useTabStoreApi();
        const [sessions,setSessions]=useState(initial);
        const [mode,setMode]=useState('project');
        const [active,setActive]=useState(null);
        state.patch=(id,patch)=>setSessions(sessions=>sessions.map(s=>s.id===id?{...s,...patch}:s));
        state.mode=mode=>{setMode(mode);setSessions(sessions=>sessions.map(s=>({...s,pinned:mode==='pinned',unreadAt:null,status:'ready'})))};
        state.readOnly=value=>tabs.setState({tabs:value?[{id:'fixture-tab',kind:'workspace',workspacePath:'/fixture/worktrees/ab12/repo',availability:'unavailable-local-directory'}]:[]});
        return <main data-testid="conversation-icons-fixture" data-mode={mode} style={{width:'min(300px, calc(100vw - 24px))',margin:'20px 12px',backgroundColor:'var(--color-sidebar)'}}>
          <ul className="space-y-1">{sessions.filter(session=>!session.archived).map(session=><WorkspaceAcpTaskItem key={session.id}
            session={session} service={service} active={session.id===active} variant={mode==='timeline'?'timeline':'default'}
            isWorktree={session.id==='session-1'} onSelect={()=>{state.selections.push(session);setActive(session.id)}}/>)}</ul>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false}}>
        <TabStoreProvider><ServiceProvider services={{acpService:service}}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
          <Fixture/>
        </TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
      </PlatformProvider>);
      `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
        document.body.className = "bg-sidebar text-foreground";
      }, theme);
      const fixture = page.getByTestId("conversation-icons-fixture");
      await fixture.waitFor();
      const catalog = await page.evaluate(() => window.__conversationIcons.catalog);
      const titleLeft = (row) =>
        row.locator('[title^="对话 "]').evaluate((element) => element.getBoundingClientRect().left);
      const row = page.getByTestId("acp-task-item-session-1");
      const icon = row.locator("[data-acp-agent-icon]");
      const pin = row.getByTestId("acp-task-pin-session-1");
      const archive = row.getByTestId("acp-task-archive-session-1");
      for (const mode of ["project", "timeline", "pinned"]) {
        await page.evaluate((mode) => window.__conversationIcons.mode(mode), mode);
        await page.locator(`[data-mode="${mode}"]`).waitFor();
        await page.mouse.move(width - 2, 2);
        await page.evaluate(() => document.activeElement?.blur());
        for (const [i, agent] of catalog.entries()) {
          const item = page.getByTestId(`acp-task-item-session-${i}`);
          const brand = item.locator("[data-acp-agent-icon]");
          assert.equal(await brand.count(), 1, `${mode}: ${agent.id} needs its own brand icon`);
          assert.equal(await brand.getAttribute("data-acp-agent-icon"), agent.id);
          assert.equal(await brand.isVisible(), true);
          assert.equal(await brand.getAttribute("aria-hidden"), "true");
          assert.equal(
            (await item.innerText()).includes(agent.name),
            false,
            `${mode}: ${agent.id} must not display a trailing Agent-name label`,
          );
          assert.equal(
            await item.getAttribute("aria-label"),
            `${await item.locator('[title^="对话 "]').getAttribute("title")}, ${agent.name}`,
            "The accessible row name must retain its title and Agent identity",
          );
          assert.equal(await item.getByTestId("acp-task-time").count(), 0);
          assert.deepEqual(
            await brand.evaluate((element) => {
              const { width, height } = element.getBoundingClientRect();
              return [width, height];
            }),
            [16, 16],
          );
          assert.equal(await item.locator("[data-idle-indicator]").count(), 0);
        }
        const before = await titleLeft(row);
        const rowHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
        const marker = row.getByTestId("worktree-conversation-indicator");
        assert.equal(await marker.isVisible(), true);
        assert.equal(await pin.count(), 0, "Idle worktree rows show their marker instead of pin");
        assert.equal(await row.locator('[data-acp-pin-badge="true"]').count(), 0);
        await row.hover();
        await pin.waitFor();
        await archive.waitFor();
        assert.equal(await marker.count(), 0, "Hover replaces the worktree marker with actions");
        assert.equal(await archive.getAttribute("aria-label"), "归档任务");
        assert.equal(await icon.isVisible(), true, "Hover retains the leading Agent identity");
        assert.equal(await titleLeft(row), before, "Hover must not move the title");
        assert.equal(
          await row.evaluate((element) => element.getBoundingClientRect().height),
          rowHeight,
          "Hover must not change row height",
        );
        assert.deepEqual(
          await row
            .locator("[data-task-row-actions] button")
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
          [mode === "pinned" ? "取消置顶任务" : "置顶任务", "归档任务"],
        );
        await archive.click();
        assert.equal(await archive.getAttribute("aria-label"), "确认");
        assert.equal(
          await row.evaluate((element) => element.getBoundingClientRect().height),
          rowHeight,
          "Archive confirmation must not change row height",
        );
        if (width === 1280 && theme === "dark" && mode === "project") {
          await fixture.screenshot({ path: "/tmp/zcode-acp-inline-archive-confirmation.png" });
        }
        assert.equal(await page.evaluate(() => window.__conversationIcons.calls.length), 0);
        assert.equal(await page.evaluate(() => window.__conversationIcons.selections.length), 0);
        await page.mouse.move(width - 2, 2);
        assert.equal(await archive.isVisible(), true, "Archive confirmation survives mouse leave");
        assert.equal(await marker.count(), 0, "Confirmation keeps the marker hidden");
        await page.keyboard.press("Escape");
        await page.evaluate(() => document.activeElement?.blur());
        await archive.waitFor({ state: "detached" });
        await row.hover();
        await archive.click();
        await page.mouse.click(width - 2, 2);
        await archive.waitFor({ state: "detached" });
        await page.mouse.move(width - 2, 2);
        assert.equal(await icon.isVisible(), true);
        await row.focus();
        await archive.waitFor();
        assert.equal(await marker.count(), 0, "Keyboard focus replaces the worktree marker");
        assert.equal(
          await icon.isVisible(),
          true,
          "Keyboard focus retains the leading Agent identity",
        );
        assert.equal(await titleLeft(row), before);
        await page.evaluate(() => document.activeElement?.blur());
        assert.equal(await icon.isVisible(), true);
        assert.equal(
          await marker.getAttribute("data-worktree-path"),
          "/fixture/worktrees/ab12/repo",
        );
        assert.ok(
          await marker.evaluate(
            (element) =>
              element.closest("li").getBoundingClientRect().right -
                element.getBoundingClientRect().right <
              10,
          ),
        );
      }

      await page.evaluate(() => {
        window.__conversationIcons.mode("project");
        window.__conversationIcons.patch("session-1", { status: "running" });
      });
      await row.locator("[data-acp-running-indicator]").waitFor();
      await assertYellowWaitingIndicator(row.locator("[data-acp-running-indicator]"), theme);
      assert.equal(await icon.isVisible(), true, "Running badge must keep Agent identity visible");
      const before = await titleLeft(row);
      await page.evaluate(() => window.__conversationIcons.patch("session-1", { unreadAt: 123 }));
      await row.locator("[data-unread-indicator]").waitFor();
      assert.equal(await row.locator("[data-acp-running-indicator]").count(), 0);
      assert.equal(await icon.isVisible(), true);
      assert.equal(await titleLeft(row), before, "Status updates must not move the title");
      await row.click();
      await page.waitForFunction(() => window.__conversationIcons.calls.length === 1);
      assert.equal(await row.getAttribute("aria-current"), "page");
      assert.deepEqual(
        await page.evaluate(() => {
          const session = window.__conversationIcons.selections[0];
          return { id: session.id, agent: session.agent, workspacePath: session.workspacePath };
        }),
        { id: "session-1", agent: "codex", workspacePath: "/fixture/worktrees/ab12/repo" },
      );
      await page.mouse.move(width - 2, 2);
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.__conversationIcons.patch("session-1", { agent: "gemini", status: "ready" });
      });
      await row.locator('[data-acp-agent-icon="gemini"]').waitFor();
      assert.equal(
        await page
          .getByTestId("acp-task-item-session-0")
          .locator("[data-acp-agent-icon]")
          .getAttribute("data-acp-agent-icon"),
        "claude",
        "Selecting or updating one session must not change another session's icon",
      );
      await row.focus();
      await pin.waitFor();
      await page.keyboard.press("Tab");
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("data-testid") === "acp-task-pin-session-1",
      );
      await archive.click();
      assert.equal(await archive.getAttribute("aria-label"), "确认");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.__conversationIcons.calls.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__conversationIcons.calls[1]), {
        id: "session-1",
        workspacePath: "/fixture/worktrees/ab12/repo",
        action: { kind: "pin", pinned: true },
      });
      assert.equal(await page.evaluate(() => window.__conversationIcons.selections.length), 1);
      assert.equal(
        await archive.getAttribute("aria-label"),
        "归档任务",
        "Pin cancels archive confirmation",
      );
      await page.keyboard.press("Escape");
      await page.mouse.move(width - 2, 2);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
      assert.equal(await row.locator('[data-acp-agent-icon="gemini"]').isVisible(), true);
      assert.equal(await row.locator('[data-acp-pin-badge="true"]').count(), 0);
      assert.equal(await pin.count(), 0, "Idle pinned worktree rows retain their marker");
      assert.equal(await row.getByTestId("worktree-conversation-indicator").isVisible(), true);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        "Sidebar rows must fit on narrow screens",
      );
      assert.deepEqual(errors, []);
      await fixture.screenshot({ path: `/tmp/zcode-conversation-icons-${width}-${theme}.png` });

      for (const mode of ["project", "timeline", "pinned"]) {
        const id = mode === "pinned" ? "session-14" : "session-1";
        await page.evaluate((mode) => window.__conversationIcons.mode(mode), mode);
        const target = page.getByTestId(`acp-task-item-${id}`);
        const action = target.getByTestId(`acp-task-archive-${id}`);
        await target.focus();
        await action.waitFor();
        await action.focus();
        const before = await page.evaluate(() => ({
          calls: window.__conversationIcons.calls.length,
          selections: window.__conversationIcons.selections.length,
        }));
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (id) =>
            document.activeElement?.getAttribute("data-testid") === `acp-task-archive-${id}` &&
            document.activeElement?.getAttribute("aria-label") === "确认",
          id,
        );
        assert.equal(
          await page.evaluate(() => window.__conversationIcons.calls.length),
          before.calls,
        );
        if (mode === "project") {
          await page.evaluate(() => {
            window.__conversationIcons.failNext = true;
          });
          await page.keyboard.press("Enter");
          await page.getByText("归档任务失败", { exact: true }).waitFor();
          assert.equal(await target.isVisible(), true, "Host failure must keep the existing row");
          await target.focus();
          await action.waitFor();
          await action.focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(
            (id) =>
              document.activeElement?.getAttribute("aria-label") === "确认" &&
              document.activeElement?.getAttribute("data-testid") === `acp-task-archive-${id}`,
            id,
          );
        }
        const expectedCalls = before.calls + (mode === "project" ? 2 : 1);
        await page.evaluate(() => {
          window.__conversationIcons.holdNext = true;
        });
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (count) => window.__conversationIcons.calls.length === count,
          expectedCalls,
        );
        assert.equal(await target.isVisible(), true, "Only the Host projection removes a row");
        assert.equal(await action.isDisabled(), true, "In-flight mutations disable archive");
        assert.equal(await target.getByTestId(`acp-task-pin-${id}`).isDisabled(), true);
        await action.evaluate((button) => button.click());
        assert.equal(
          await page.evaluate(() => window.__conversationIcons.calls.length),
          expectedCalls,
        );
        assert.deepEqual(await page.evaluate(() => window.__conversationIcons.calls.at(-1)), {
          id,
          workspacePath: id === "session-1" ? "/fixture/worktrees/ab12/repo" : "/fixture/repo",
          ...(id === "session-14"
            ? { workspaceIdentity: "remote:fixture", remoteSessionId: "attachment-fixture" }
            : {}),
          action: { kind: "archive", archived: true },
        });
        assert.equal(
          await page.evaluate(() => window.__conversationIcons.selections.length),
          before.selections,
        );
        await page.evaluate(() => window.__conversationIcons.release());
        await target.waitFor({ state: "detached" });
        await page.evaluate((id) => window.__conversationIcons.patch(id, { archived: false }), id);
        await target.waitFor();
      }
      await row.focus();
      await page.evaluate(() => window.__conversationIcons.readOnly(true));
      await archive.waitFor({ state: "detached" });
      assert.equal(await pin.isDisabled(), true);
      await page.evaluate(() => window.__conversationIcons.readOnly(false));
      await archive.waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  const touch = await browser.newPage({
    viewport: { width: 375, height: 1000 },
    isMobile: true,
    hasTouch: true,
  });
  await touch.goto(`${origin}/${name}.html`);
  const touchRow = touch.getByTestId("acp-task-item-session-1");
  const touchAction = touchRow.getByTestId("acp-task-archive-session-1");
  const touchPin = touchRow.getByTestId("acp-task-pin-session-1");
  await touchAction.waitFor();
  assert.equal(await touch.evaluate(() => matchMedia("(hover: none)").matches), true);
  assert.equal(await touchRow.getByTestId("acp-task-time").count(), 0);
  assert.equal(await touchRow.getByTestId("worktree-conversation-indicator").count(), 0);
  assert.equal(await touchRow.locator("[data-acp-agent-icon]").isVisible(), true);
  await touchAction.tap();
  assert.equal(await touchAction.getAttribute("aria-label"), "确认");
  await touch.touchscreen.tap(374, 5);
  assert.equal(await touchAction.getAttribute("aria-label"), "归档任务");
  assert.equal(await touch.evaluate(() => window.__conversationIcons.calls.length), 0);
  await touchPin.tap();
  await touch.waitForFunction(() => window.__conversationIcons.calls.length === 1);
  assert.deepEqual(await touch.evaluate(() => window.__conversationIcons.calls[0]), {
    id: "session-1",
    workspacePath: "/fixture/worktrees/ab12/repo",
    action: { kind: "pin", pinned: true },
  });
  assert.equal(await touchRow.locator("[data-acp-agent-icon]").isVisible(), true);
  await touchAction.tap();
  await touchAction.tap();
  await touchRow.waitFor({ state: "detached" });
  assert.equal(await touch.evaluate(() => window.__conversationIcons.selections.length), 0);
  await touch.touchscreen.tap(374, 5);
  await touch.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
  assert.ok(
    await touch.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  await touch.close();
  process.stdout.write(
    "PASS: session icons, trailing pin/archive layout, confirmation/cancellation, scoped Host success/failure, busy/read-only, keyboard/touch, worktree and themes.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
