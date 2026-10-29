// Real Host + SessionPane/composer; synthetic Agent, isolated storage, no model requests.
// ZCODE_E2E_BASE_URL=http://localhost:5174 pnpm exec tsx packages/ui/test/acpStopReuse.e2e.mts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createAcpService } from "../../services/src/acp/acpServiceImpl.js";
import { readPersistedAcpSession } from "../../services/test/acpTestStorage.js";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-stop-reuse-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const directory = await mkdtemp(join(tmpdir(), "acp-stop-e2e-"));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 375]) {
    const remote = width === 375;
    const workspace = {
      workspacePath: "/synthetic/stop-reuse",
      ...(remote
        ? { workspaceIdentity: "fixture:remote-stop", remoteSessionId: "attachment-stop" }
        : {}),
    };
    const calls: string[] = [];
    let connections = 0;
    let finish: (() => void) | undefined;
    const cancelSeen = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const service = createAcpService({
      directory: join(directory, String(width)),
      connect: async (input) => {
        connections++;
        return {
          sessionId: "same-native-session",
          configOptions: [],
          modeState: null,
          async setConfigOption() {
            return [];
          },
          async setMode() {},
          async prompt(text) {
            calls.push(text);
            if (calls.length === 2) secondStarted.resolve();
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            await input.onUpdate({ kind: "text", text: `reply ${text}` });
          },
          async cancel() {
            cancelSeen.resolve();
          },
          close() {
            finish?.();
          },
        };
      },
    });
    const session = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: session.id };
    const initialTurn = service.prompt({ ...target, commandId: "first", text: "first" });
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const subscriptions = new Map<string, { dispose(): void }>();
    const publish = (key: string, event: unknown) => {
      void page
        .evaluate(({ key, event }) => (window as any).__hostEvent?.(key, event), { key, event })
        .catch(() => {});
    };
    try {
      await page.exposeFunction("__hostSubscribe", (kind: string, key: string, input: any) => {
        const subscribe =
          kind === "summary"
            ? service.onDynamicSessionSummaryChanged(input)
            : service.onDynamicConversationChanged(input);
        subscriptions.set(
          key,
          subscribe((event: any) => publish(key, event)),
        );
      });
      await page.exposeFunction("__hostUnsubscribe", (key: string) => {
        subscriptions.get(key)?.dispose();
        subscriptions.delete(key);
      });
      await page.exposeFunction("__hostCall", (method: string, input: any) => {
        const methods = [
          "listSummaries",
          "refreshSummary",
          "readConversation",
          "conversationRowsRange",
          "sendConversationCommand",
          "queryConversationCommand",
          "stop",
          "updateRow",
        ];
        assert.ok(methods.includes(method));
        return (service as any)[method](input);
      });
      await writeFile(
        html,
        `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
      );
      await writeFile(
        moduleFile,
        `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
        import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
        import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
        import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
        import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
        import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
        import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
        import '../../../ui/src/styles.css';
        const session=${JSON.stringify(session)};
        const workspace=${JSON.stringify(workspace)};
        const listeners=new Map(), pending=new Map();
        window.__hostEvent=(key,event)=>listeners.get(key)?.(event);
        const subscribe=(kind,input)=>listener=>{
          const key=crypto.randomUUID(); listeners.set(key,listener);
          const ready=window.__hostSubscribe(kind,key,input);
          if(kind==='body')pending.set(input.subscriptionId,ready);
          return {dispose(){listeners.delete(key);void window.__hostUnsubscribe(key)}};
        };
        const call=method=>input=>window.__hostCall(method,input);
        const acpService={
          listAvailableAgents:async()=>[{agent:'codex',enabled:true,ready:true}],listAgentConfigs:async()=>[],listPlugins:async()=>[],
          onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),
          listSummaries:call('listSummaries'),refreshSummary:call('refreshSummary'),
          readConversation:async input=>{await pending.get(input.subscriptionId);return window.__hostCall('readConversation',input)},
          conversationRowsRange:call('conversationRowsRange'),
          sendConversationCommand:call('sendConversationCommand'),queryConversationCommand:call('queryConversationCommand'),
          stop:call('stop'),
          updateRow:call('updateRow'),
          onDynamicSessionSummaryChanged:input=>subscribe('summary',input),
          onDynamicConversationChanged:input=>subscribe('body',input),
        };
        const forbidden=()=>{throw new Error('unexpected native operation')};
        const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
        const services={settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
          subagentsService:{list:async()=>({agents:[],capability:null})},
          clientScenesService:{list:async()=>({code:0,data:[]})},
          modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})},acpService};
        const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
        createRoot(document.getElementById('root')!).render(
          <PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}>
          <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><V4ConversationContext.Provider value={native as never}>
          <main className="h-screen bg-background text-foreground p-2"><SessionPane paneId="stop-fixture" {...workspace} sessionId={null} focused acpBoundSessionId={session.id} acpOpenRequest={{requestId:1,session}}/></main>
          </V4ConversationContext.Provider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
      `,
      );
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
      const input = page.locator('[data-testid="v4-composer-input"]');
      const send = page.locator('[data-testid="v4-composer-send"]');
      await page
        .locator('[data-testid="v4-stop"]')
        .waitFor({ timeout: 30000 })
        .catch((error) => {
          throw new Error(`${error.message}; page errors: ${errors.join("; ")}`);
        });
      await page.locator('[data-testid="v4-stop"]').click();
      await cancelSeen.promise;
      await input.fill("second");
      assert.equal(
        await send.isDisabled(),
        true,
        "new execution stays fenced until old prompt ends",
      );
      assert.deepEqual(calls, ["first"]);
      finish?.();
      await initialTurn;
      await page.waitForFunction(
        () =>
          !(document.querySelector('[data-testid="v4-composer-send"]') as HTMLButtonElement)
            ?.disabled,
      );
      if (remote) {
        // Reconnect to the same attachment after cancellation; readiness and rows
        // must come from the real Host snapshot, without launching another Agent.
        await page.reload();
        await input.waitFor();
        await input.fill("second");
        await page.waitForFunction(
          () =>
            !(document.querySelector('[data-testid="v4-composer-send"]') as HTMLButtonElement)
              ?.disabled,
        );
      }
      await send.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
      );
      await secondStarted.promise;
      assert.deepEqual(calls, ["first", "second"]);
      assert.equal(connections, 1, "stop/send/reconnect must retain the original Agent");
      finish?.();
      await page.getByText("reply second", { exact: true }).waitFor();
      await page.locator('[data-testid="v4-stop"]').waitFor({ state: "detached" });
      assert.equal(await page.getByText("reply first", { exact: true }).count(), 0);
      const persisted = await readPersistedAcpSession(
        join(directory, String(width), `${session.id}.json`),
      );
      assert.equal(
        persisted.entries[0]?.kind === "user" && persisted.entries[0].stopReason,
        "cancelled",
      );
      assert.deepEqual(
        persisted.entries.filter((entry) => entry.kind === "user").map((entry) => entry.text),
        ["first", "second"],
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px ${remote ? "replayable attachment" : "continuous desktop"}: stop fence, one Agent, next send, durable cancelled turn`,
      );
    } finally {
      finish?.();
      for (const subscription of subscriptions.values()) subscription.dispose();
      await page.close();
      await service.disposeAllAndWait();
    }
  }
} finally {
  await browser.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
  await rm(directory, { recursive: true, force: true });
}
