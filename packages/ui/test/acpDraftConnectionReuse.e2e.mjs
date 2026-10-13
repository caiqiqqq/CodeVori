// Run with the desktop Vite server on 5174. Fake Host: never sends a model prompt.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-reuse-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
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
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { useAcpConversation } from "../../../ui/test/acpProjectionFixture.tsx";
      const store = new Map();
      const listeners = new Set();
      const events = [];
      let counter = 0;
      let rejectRefresh = false;
      let releaseCreate = null;
      let delayRefresh = false;
      const pendingRefreshes = [];
      const service = {
        onDynamicSessionChanged: () => listener => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
        list: async () => [],
        create: async ({ agent, workspacePath }) => {
          events.push('create:' + agent);
          if (releaseCreate && agent === 'codex') await new Promise(resolve => { releaseCreate = resolve; });
          const id = agent + ':' + ++counter;
          const session = { id, agent, workspacePath, provisional: true,
            revision: 0, status: 'idle', entries: [], configOptions: [{ id: 'mode', name: 'Mode',
            type: 'select', category: 'mode', currentValue: 'agent', options: [{ value: 'agent', name: 'Agent' }] }],
            modeState: null };
          store.set(id, session);
          return session;
        },
        refresh: async ({ id }) => {
          events.push('refresh:' + id);
          if (delayRefresh) await new Promise(resolve => { pendingRefreshes.push(resolve); });
          if (rejectRefresh || !store.has(id)) throw new Error('adapter disconnected');
          return store.get(id);
        },
        remove: async ({ id }) => {
          events.push('remove:' + id);
          store.delete(id);
          for (const listener of listeners) listener({ kind: 'removed', id });
        },
        setConfigOption: async ({ id }) => {
          events.push('config:' + id);
          if (!store.has(id)) throw new Error('stale config');
        },
      };
      window.__events = events;
      window.__store = store;
      window.__rejectRefresh = value => { rejectRefresh = value; };
      window.__delayCreate = () => { releaseCreate = true; };
      window.__releaseCreate = () => { if (typeof releaseCreate === 'function') releaseCreate(); releaseCreate = null; };
      window.__delayRefresh = () => { delayRefresh = true; };
      window.__releaseRefresh = () => { delayRefresh = false; for (const release of pendingRefreshes.splice(0)) release(); };
      window.__addHistory = (agent) => {
        const session = { ...store.get([...store.keys()].find(id => id.startsWith(agent + ':'))),
          id: 'history:' + agent, revision: 1, provisional: false };
        store.set(session.id, session);
        for (const listener of listeners) listener({ kind: 'updated', session });
        return session.id;
      };
      function Fixture() {
        const [agent, setAgent] = useState(null);
        const [workspacePath, setWorkspacePath] = useState('/one');
        const [visible, setVisible] = useState(true);
        window.__switch = setAgent;
        window.__workspace = setWorkspacePath;
        window.__unmount = () => setVisible(false);
        return visible ? <Pane agent={agent} workspacePath={workspacePath} /> : null;
      }
      function Pane({ agent, workspacePath }) {
        const conversation = useAcpConversation(service as never, { workspacePath }, agent);
        window.__reset = conversation.resetSelection;
        window.__selectHistory = (nextAgent, id) => conversation.selectById(nextAgent, id);
        return <div data-testid="state" data-agent={agent ?? 'api'}
          data-id={conversation.selected?.id ?? ''} data-ready={conversation.loaded && conversation.ready && !conversation.busy}
          data-error={conversation.error ?? ''} data-options={conversation.selected?.configOptions.length ?? 0} />;
      }
      createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><Fixture /></ZCodeIntlProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:5174/${name}.html`);
  const state = page.getByTestId("state");
  const switchTo = async (agent) => page.evaluate((value) => window.__switch(value), agent);
  const ready = async (agent) =>
    page
      .waitForFunction(
        (value) => {
          const element = document.querySelector('[data-testid="state"]');
          return element?.dataset.agent === value && element?.dataset.ready === "true";
        },
        agent,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        throw new Error(
          `${error.message}; state=${JSON.stringify(await state.evaluate((element) => element.dataset))}; events=${JSON.stringify(await events())}`,
        );
      });
  const events = async () => page.evaluate(() => [...window.__events]);

  await switchTo("codex");
  await ready("codex");
  const firstCodexId = await state.getAttribute("data-id");
  await switchTo("claude");
  await ready("claude");
  const firstClaudeId = await state.getAttribute("data-id");
  await page.evaluate(() => window.__delayRefresh());
  await switchTo("codex");
  await page.waitForFunction(() => window.__events.includes("refresh:codex:1"));
  await switchTo("claude");
  await page.waitForFunction(() => window.__events.includes("refresh:claude:2"));
  await page.evaluate(() => window.__releaseRefresh());
  await ready("claude");
  await switchTo("codex");
  await page.waitForFunction(
    () => window.__events.filter((e) => e === "refresh:codex:1").length === 2,
  );
  await ready("codex");
  assert.equal(await state.getAttribute("data-id"), firstCodexId);
  assert.equal((await events()).filter((event) => event === "create:codex").length, 1);
  assert.ok((await events()).includes(`refresh:${firstCodexId}`));
  assert.equal((await events()).includes(`remove:${firstCodexId}`), false);

  await switchTo(null);
  await switchTo("codex");
  await ready("codex");
  assert.equal(await state.getAttribute("data-id"), firstCodexId);
  assert.equal((await events()).filter((event) => event === "create:codex").length, 1);

  await switchTo("gemini");
  await ready("gemini");
  assert.ok((await events()).includes(`remove:${firstClaudeId}`), "LRU provisional closes");
  await switchTo("claude");
  await ready("claude");
  assert.equal((await events()).filter((event) => event === "create:claude").length, 2);

  // A stale retained connection cannot make the controls usable.
  await page.evaluate(() => window.__rejectRefresh(true));
  await switchTo("gemini");
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="state"]')
      ?.dataset.error?.includes("adapter disconnected"),
  );
  assert.equal(await state.getAttribute("data-ready"), "false");
  await page.evaluate(() => window.__rejectRefresh(false));

  await switchTo("claude");
  await ready("claude");
  const oldWorkspaceIds = await page.evaluate(() => [...window.__store.keys()]);
  await page.evaluate(() => window.__workspace("/two"));
  await ready("claude");
  await page.waitForFunction((ids) => ids.every((id) => !window.__store.has(id)), oldWorkspaceIds);
  assert.equal(
    await page.evaluate(
      (id) => window.__store.get(id)?.workspacePath,
      await state.getAttribute("data-id"),
    ),
    "/two",
  );

  await page.evaluate(() => {
    window.__reset();
    window.__switch(null);
  });
  await page.waitForFunction(() => window.__store.size === 0);
  await page.evaluate(() => window.__delayCreate());
  await switchTo("codex");
  await page.waitForFunction(() => window.__events.at(-1) === "create:codex");
  await switchTo("claude");
  await ready("claude");
  const activeClaudeId = await state.getAttribute("data-id");
  const countBeforeLateCreate = (await events()).length;
  await page.evaluate(() => window.__releaseCreate());
  await page.waitForFunction(
    (from) => window.__events.slice(from).some((e) => e.startsWith("remove:codex:")),
    countBeforeLateCreate,
  );
  assert.equal(await state.getAttribute("data-id"), activeClaudeId);
  const historyId = await page.evaluate(() => window.__addHistory("claude"));
  await page.evaluate((id) => window.__selectHistory("claude", id), historyId);
  await page.waitForFunction(
    (id) => document.querySelector('[data-testid="state"]')?.dataset.id === id,
    historyId,
  );
  await ready("claude");
  assert.ok(
    (await events()).includes(`remove:${activeClaudeId}`),
    "Exact history click releases Agent draft",
  );
  await page.evaluate(() => window.__unmount());
  await page.waitForFunction(
    (id) => [...window.__store.keys()].every((key) => key === id),
    historyId,
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: retained draft reuse, bounded eviction, stale refresh/create, New Task and unmount cleanup.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
