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
          ? { kind: 'api', modelSelection: { providerId: 'provider-a', modelId: 'model-a' }, mode: 'build' }
          : { kind: 'acp', agent: 'codex', config: [] },
        status: 'running', attempts: [], session: { kind: 'acp', id: id + '-child' },
      });
      const initial = [makeTask('first', start + 1000), makeTask('second', start + 5000, 'api'), makeTask('unmatched', start - 1000)];
      function Fixture() {
        const [tasks, setTasks] = useState(initial);
        const [secondTurn, setSecondTurn] = useState(false);
        window.__turnDelegation = {
          showSecond: () => setSecondTurn(true),
          finishFirst: () => setTasks(items => items.map(item => item.id === 'first' ? { ...item, status: 'completed', attempts: [{ sequence: 1, status: 'completed', endedAt: Date.now(), result: { conclusion: '完成了第一轮', changedFiles: [], tests: [], risks: [], blockers: [], structured: true } }] } : item)),
        };
        const entries = [{ id: 'user:first', kind: 'user', text: '第一轮', createdAt: start, endedAt: start + 2000 },
          { id: 'assistant:first', kind: 'assistant', text: '第一轮回复', createdAt: start + 500 }];
        if (secondTurn) entries.push({ id: 'user:second', kind: 'user', text: '第二轮', createdAt: start + 4000 }, { id: 'assistant:second', kind: 'assistant', text: '第二轮回复', createdAt: start + 4500 });
        const rows = buildAcpConversationRows({ entries, status: 'idle' } as never);
        const controller = { tasks, editing: null, error: null, busy: false, cancel: async () => {}, cancelAll: async () => {}, retry: async () => {}, resume: async () => {}, open: async () => {}, redeliver: async () => {}, openEditor: () => {}, closeEditor: () => {} };
        return <div className="h-screen flex flex-col bg-background text-foreground">
          <button onClick={() => setSecondTurn(true)}>第二轮到来</button>
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
      assert.match(await page.getByTestId("delegation-panel").innerText(), /2\/2/);
      await page.getByRole("button", { name: "第二轮到来" }).click();
      await turns.nth(1).getByText("委派 second").waitFor();
      assert.match(await turns.first().innerText(), /委派 first/);
      assert.match(await page.getByTestId("delegation-panel").innerText(), /1\/1/);
      await page.evaluate(() => window.__turnDelegation.finishFirst());
      const first = turns.first().getByTestId("delegation-task");
      await first.getByText("已完成").waitFor();
      await first.locator('[data-testid^="tool-summary-trigger-"]').click();
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
      await page.close();
    }
  }
  process.stdout.write(
    `PASS delegation turn placement and updates at 1280/375 in both themes. Screenshots: ${shots}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
