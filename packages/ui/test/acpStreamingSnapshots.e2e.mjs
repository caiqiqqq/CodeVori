// pnpm exec tsx packages/ui/test/acpStreamingSnapshots.e2e.mjs
// Real Host persistence and timeline; synthetic adapter, isolated files, no model requests.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createAcpService } from "../../services/src/acp/acpServiceImpl.ts";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-streaming-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const directory = await mkdtemp(join(tmpdir(), "acp-streaming-e2e-"));
let update;
let finish;
let started;
const ready = new Promise((resolve) => {
  started = resolve;
});
const turnEnd = new Promise((resolve) => {
  finish = resolve;
});
const service = createAcpService({
  directory,
  connect: async (input) => {
    update = input.onUpdate;
    return {
      sessionId: "synthetic-streaming",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        started();
        await turnEnd;
      },
      async cancel() {
        finish();
      },
      close() {
        finish();
      },
    };
  },
});
let browser;
try {
  const workspace = { workspacePath: "/synthetic/browser", workspaceIdentity: "browser:stream" };
  const session = await service.create({ ...workspace, agent: "codex" });
  const snapshots = [];
  const subscription = service.onDynamicSessionChanged(workspace)((change) => {
    if (change.kind === "updated") snapshots.push(change.session);
  });
  const turn = service.prompt({
    ...workspace,
    id: session.id,
    commandId: "browser-turn",
    text: "测试流式输出",
  });
  await ready;
  await update({ kind: "text", text: "我" });
  const first = snapshots.at(-1);
  const batch = "正在持续输出，第一批文字已完整显示。";
  await Promise.all([...batch].map((text) => update({ kind: "text", text })));
  const live = snapshots.at(-1);
  const tail = "第二批文字与停止前的尾段也全部保留。";
  await Promise.all([...tail].map((text) => update({ kind: "text", text })));
  finish();
  const completed = await turn;
  const replay = JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8"));
  assert.deepEqual(replay, completed);
  subscription.dispose();
  const data = { first, live, replay };
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
      import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const data=${JSON.stringify(data)};
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      function Fixture(){
        const [snapshot,setSnapshot]=useState(data.first);
        const [epoch,setEpoch]=useState(0);
        window.__stream={live:()=>setSnapshot(data.live),finish:()=>setSnapshot(data.replay),
          replay:()=>{setSnapshot(structuredClone(data.replay));setEpoch(e=>e+1)}};
        const rows=buildAcpConversationRows(snapshot);
        return <div className="h-screen flex flex-col bg-background text-foreground" data-ready="true"
          data-status={snapshot.status} data-revision={snapshot.revision}>
          <ConversationTimeline key={epoch} sessionKey={'stream-'+epoch} rows={rows} totalCount={rows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/browser',
              theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'stream-'+epoch}} />
        </div>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    const assistant = page
      .locator('[data-conversation-selectable="true"]')
      .filter({ hasText: /^我/ });
    await assistant.waitFor();
    assert.equal(await assistant.innerText(), "我");
    const firstRevision = await page.locator('[data-ready="true"]').getAttribute("data-revision");
    await page.evaluate(() => window.__stream.live());
    await page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('[data-conversation-selectable="true"]')].some(
          (node) => node.textContent === text,
        ),
      "我" + batch,
    );
    assert.equal(await page.locator('[data-ready="true"]').getAttribute("data-status"), "running");
    assert.ok(
      Number(await page.locator('[data-ready="true"]').getAttribute("data-revision")) >
        Number(firstRevision),
    );
    await page.evaluate(() => window.__stream.finish());
    await page.waitForFunction(
      () => document.querySelector('[data-ready="true"]')?.getAttribute("data-status") === "idle",
    );
    assert.equal(await assistant.innerText(), "我" + batch + tail);
    await page.evaluate(() => window.__stream.replay());
    await assistant.waitFor();
    assert.equal(await assistant.innerText(), "我" + batch + tail);
    assert.equal(await assistant.count(), 1, "replay must not duplicate assistant output");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: join(directory, `stream-${width}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS: Host persisted first/burst/terminal snapshots, desktop live updates and mobile-width replay at 1280/375px. Screenshots: ${directory}`,
  );
} finally {
  finish();
  await service.disposeAllAndWait();
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
