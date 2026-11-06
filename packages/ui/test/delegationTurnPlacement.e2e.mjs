// Real timeline and task row, synthetic Host facts. Run with desktop Vite on 5174.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__delegation-turn-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const shots = await mkdtemp(join(tmpdir(), "zcode-delegation-turn-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ConversationTimeline } from '../../../ui/src/v4/ConversationTimeline.tsx';
      import { ToolCallBlock } from '../../../ui/src/ToolCallBlocks.tsx';
      import { buildAcpConversationRows } from '../../../ui/src/v4/acpConversationRows.ts';
      import { ZCodeIntlProvider } from '../../../ui/src/i18n/IntlProvider.tsx';
      import { TooltipProvider } from '../../../ui/src/components/ui/tooltip.tsx';
      import { PlatformProvider } from '../../../ui/src/hooks/usePlatform.tsx';
      import { ServiceProvider } from '../../../ui/src/hooks/useServices.tsx';
      import { TabStoreProvider } from '../../../ui/src/store/TabStoreProvider.tsx';
      import { DEFAULT_CODE_PREVIEW_SETTINGS } from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const start = Date.now() - 8000;
      const parent = { workspacePath: '/synthetic/project', kind: 'acp', sessionId: 'parent' };
      const makeTask = (id, createdAt, kind = 'acp') => ({
        id, createdAt, title: '委派 ' + id, parent,
        execution: kind === 'api'
          ? { kind: 'api', modelSelection: { providerId: 'provider-a', modelId: 'model-with-a-very-long-name-for-responsive-layout' }, mode: 'build' }
          : { kind: 'acp', agent: 'codex', config: [] },
        status: 'running', attempts: [], session: { kind: 'acp', id: id + '-child' },
      });
      const initial = [makeTask('first', start + 1000), makeTask('second', start + 5000, 'api'), makeTask('unmatched', start - 1000)];
      const opened = [];
      function Fixture() {
        const [tasks, setTasks] = useState(initial);
        const [secondTurn, setSecondTurn] = useState(false);
        window.__turnDelegation = {
          showSecond: () => setSecondTurn(true),
          opened,
          setFirstStatus: (status, session = true) => setTasks(items => items.map(item => item.id === 'first' ? { ...item, status, session: session ? {kind:'acp',id:'first-child'} : undefined } : item)),
          finishFirst: () => setTasks(items => items.map(item => item.id === 'first' ? { ...item, status: 'completed', attempts: [{ sequence: 1, status: 'completed', endedAt: Date.now(), result: { conclusion: '完成了第一轮', changedFiles: [], tests: [], risks: [], blockers: [], structured: true } }] } : item)),
        };
        const entries = [{ id: 'user:first', kind: 'user', text: '第一轮', createdAt: start, endedAt: start + 2000 },
          { id: 'assistant:first', kind: 'assistant', text: '第一轮回复', createdAt: start + 500 }];
        if (secondTurn) entries.push({ id: 'user:second', kind: 'user', text: '第二轮', createdAt: start + 4000 }, { id: 'assistant:second', kind: 'assistant', text: '第二轮回复', createdAt: start + 4500 });
        const rows = buildAcpConversationRows({ entries, status: 'idle' } as never);
        const controller = { tasks, editing: null, error: null, busy: false, cancel: async () => {}, cancelAll: async () => {}, retry: async () => {}, resume: async () => {}, open: async task => window.__turnDelegation.opened.push(task.session.id), redeliver: async () => {}, openEditor: () => {}, closeEditor: () => {} };
        return <div className="h-screen flex flex-col bg-background text-foreground">
          <button onClick={() => setSecondTurn(true)}>第二轮到来</button>
          <div data-testid="native-agent-reference" className="px-4 py-3">
            <ToolCallBlock workspacePath={parent.workspacePath} disableSummaryContentAnimation
              agentSummaryAction={{onActivate: () => window.__turnDelegation.opened.push('native-child')}}
              toolCallNode={{toolCall:{toolId:'native-agent', toolName:'Agent', kind:'agent', input:{subagent_type:'codex',description:'委派 first'}, status:'running'},childToolCalls:[]}} />
          </div>
          <ConversationTimeline rows={rows} totalCount={rows.length} sessionKey="parent" hideTurnNavigator
            rowContext={{ workspacePath: parent.workspacePath, theme: 'zai-light', codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS, logEpoch: 'fixture' }}
            delegation={{ parent, controller: controller as never }} />
        </div>;
      }
      const services = { providerSettingsService: { getView: async () => ({ revision: 1, providers: [], providerOrder: [], providerTemplates: [] }), onDidChange: () => ({ dispose() {} }) } };
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isMacOS:false,isWindows:false,isLinux:false,isWeb:true} as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
      await page.evaluate(
        (theme) => document.documentElement.classList.add(`theme-${theme}`),
        theme,
      );
      const turns = page.locator("[data-v4-turn-unit]");
      await turns.first().getByTestId("delegation-task").waitFor();
      const first = turns.first().getByTestId("delegation-task");
      const summary = first.locator('[data-testid^="tool-summary-trigger-"]');
      const native = page.getByTestId("native-agent-reference");
      const nativeSummary = native.locator('[data-testid^="tool-summary-trigger-"]');
      await nativeSummary.waitFor();
      assert.match(await summary.innerText(), /子智能体.*codex.*·.*委派 first/s);
      assert.equal(await summary.getAttribute("class"), await nativeSummary.getAttribute("class"));
      assert.equal(
        await summary.locator("svg").getAttribute("class"),
        await nativeSummary.locator("svg").getAttribute("class"),
      );
      const nameStyle = (element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.fontWeight, style.color, style.lineHeight];
      };
      assert.deepEqual(
        await summary.getByText("codex", { exact: true }).evaluate(nameStyle),
        await nativeSummary.getByText("codex", { exact: true }).evaluate(nameStyle),
      );
      assert.equal(await first.locator("summary").count(), 0, "details stay closed by default");
      await summary.click();
      await summary.press("Enter");
      await summary.press("Space");
      assert.deepEqual(await page.evaluate(() => window.__turnDelegation.opened), [
        "first-child",
        "first-child",
        "first-child",
      ]);
      assert.equal(
        await first.locator("summary").count(),
        0,
        "opening a child does not expand inline details",
      );
      assert.match(await turns.first().innerText(), /委派 first/);
      assert.equal(
        await turns.first().evaluate((turn) => {
          const task = turn.querySelector('[data-testid="delegation-task"]');
          const answer = [...turn.querySelectorAll("*")].find(
            (element) => element.textContent === "第一轮回复",
          );
          return Boolean(
            task &&
            answer &&
            task.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
        }),
        true,
        "delegation summary precedes the final answer inside its turn",
      );
      assert.equal(await turns.first().getByText("委派 second").count(), 0);
      assert.equal(
        await page.getByTestId("delegation-panel").getByTestId("delegation-task").count(),
        2,
      );
      await page.getByRole("button", { name: "第二轮到来" }).click();
      await turns.nth(1).getByText("委派 second").waitFor();
      assert.match(await turns.first().innerText(), /委派 first/);
      assert.equal(
        await page.getByTestId("delegation-panel").getByTestId("delegation-task").count(),
        1,
      );
      await page.screenshot({
        path: join(shots, `summary-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      for (const [status, label] of [
        ["queued", "等待执行"],
        ["preparing", "准备中"],
        ["running", "执行中"],
        ["awaiting_input", "等待授权"],
        ["failed", "失败"],
        ["interrupted", "已中断"],
        ["canceled", "已取消"],
      ]) {
        await page.evaluate((status) => window.__turnDelegation.setFirstStatus(status), status);
        await first.getByText(label, { exact: true }).waitFor();
        assert.equal(
          await first.locator("summary").count(),
          0,
          `${status} does not auto-open details`,
        );
      }
      await page.evaluate(() => window.__turnDelegation.setFirstStatus("queued", false));
      await first.getByText("等待执行", { exact: true }).waitFor();
      assert.equal(await summary.getAttribute("role"), null, "unbound session has no open action");
      await page.evaluate(() => window.__turnDelegation.finishFirst());
      await first.getByText("已完成").waitFor();
      await first.getByRole("button", { name: "展开工具详情", exact: true }).press("Enter");
      assert.deepEqual(
        await page.evaluate(() => window.__turnDelegation.opened),
        ["first-child", "first-child", "first-child"],
        "details never navigate",
      );
      await first.locator("summary").click();
      assert.match(await first.innerText(), /完成了第一轮/);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      // 仅等待折叠动画结束再取视觉证据，行为断言已在上面完成。
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(shots, `turn-${theme}-${width}.png`), fullPage: true });
      await first.getByRole("button", { name: "收起工具详情", exact: true }).click();
      await first.locator("summary").waitFor({ state: "hidden" });
      await page.close();
    }
  }
  process.stdout.write(
    `PASS native/delegated agent summary parity, keyboard/session actions, all statuses, details/results and turn placement at 1280/375 in both themes. Screenshots: ${shots}\n`,
  );
} catch (error) {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      await page.screenshot({ path: join(shots, "failure.png"), fullPage: true });
    }
  }
  process.stderr.write(`Failure screenshot: ${shots}\n`);
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
