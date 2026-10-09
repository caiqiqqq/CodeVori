// Run against the desktop Vite server: pnpm exec tsx packages/ui/test/acpPermissionMemory.e2e.mts
// Real composer hook/toolbar + isolated real Host; the ACP port is fake and never invokes a model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { AcpConfigOption } from "@zcode/shared";
import {
  createAcpService,
  type AcpConnectionFactory,
} from "../../services/src/acp/acpServiceImpl.js";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-permission-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const directory = await mkdtemp(join(tmpdir(), "zcode-permission-e2e-"));
const calls: Array<{ kind: string; value?: string | boolean }> = [];
const serverErrors: string[] = [];
const mode = (value = "agent"): AcpConfigOption => ({
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: value,
  options: [
    { value: "agent", name: "Agent" },
    { value: "agent-full-access", name: "Full access" },
  ],
});
const connect: AcpConnectionFactory = async ({ sessionId }) => ({
  sessionId: sessionId ?? randomUUID(),
  configOptions: [mode()],
  modeState: null,
  async setConfigOption(_id, value) {
    calls.push({ kind: "permission", value });
    return [mode(String(value))];
  },
  async setMode() {},
  async prompt() {
    throw new Error("This fixture must never prompt an Agent");
  },
  async cancel() {},
  close() {},
});
let service = createAcpService({ directory, connect });
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    let result: unknown;
    switch (request.url) {
      case "/create":
        result = await service.create(input);
        break;
      case "/list":
        result = await service.list(input);
        break;
      case "/refresh":
        result = await service.refresh(input);
        break;
      case "/setConfigOption":
        result = await service.setConfigOption(input);
        break;
      case "/remove":
        await service.remove(input);
        result = null;
        break;
      case "/restart":
        await service.disposeAllAndWait();
        service = createAcpService({ directory, connect });
        result = null;
        break;
      default:
        throw new Error("Unknown fixture command");
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    serverErrors.push(`${request.url}: ${error instanceof Error ? error.message : String(error)}`);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useAcpConversation} from '../../../ui/src/v4/useAcpConversation.ts';
    import {AcpComposerConfigControls} from '../../../ui/src/v4/composer/AcpComposerConfigControls.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const listeners = new Set();
    window.__permissionRequests = [];
    const rpc = async (command, input) => {
      window.__permissionRequests.push({command,input});
      const response = await fetch(${JSON.stringify(endpoint)}+'/'+command, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)
      });
      const result = await response.json();
      if(!response.ok) throw new Error(result.error);
      if(result?.id) for(const listener of listeners) listener({kind:'updated',session:result});
      if(command==='remove') for(const listener of listeners) listener({kind:'removed',id:input.id});
      return result;
    };
    const service = Object.fromEntries(['create','list','refresh','setConfigOption','remove'].map(command=>[command,input=>rpc(command,input)]));
    service.onDynamicSessionChanged = () => listener => {
      listeners.add(listener); return {dispose:()=>listeners.delete(listener)};
    };
    function Fixture(){
      const [identity,setIdentity]=useState('workspace:one');
      window.__permissionWorkspace=setIdentity;
      const conversation=useAcpConversation(service as never,{
        workspacePath:'/fixture/permission-e2e',workspaceIdentity:identity
      },'codex');
      const ready=conversation.loaded&&conversation.ready&&!conversation.busy;
      return <div data-testid="permission-state" data-ready={ready} data-error={conversation.error??''}>
        <AcpComposerConfigControls agent="codex" sessionId={conversation.selected?.id}
          options={conversation.selected?.configOptions??[]} modes={conversation.selected?.modeState??null}
          disabled={!ready} onChange={conversation.setConfigOption}/>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      // Host 重启已销毁旧临时会话；旧页面卸载时的 best-effort remove 可以返回不存在。
      if (response.status() >= 400 && !response.url().endsWith("/remove"))
        errors.push(`${response.status()}: ${response.url()}`);
    });
    const ready = async () => {
      await page
        .waitForFunction(
          () =>
            document
              .querySelector('[data-testid="permission-state"]')
              ?.getAttribute("data-ready") === "true",
        )
        .catch(async (error) => {
          throw new Error(
            `${error.message}; errors=${JSON.stringify(errors)}; state=${await page.locator("body").innerText()}; requests=${JSON.stringify(await page.evaluate(() => (window as any).__permissionRequests))}`,
          );
        });
    };
    await page.goto(`http://127.0.0.1:5174/${name}.html`);
    await ready();
    const trigger = page.getByTestId("acp-config-trigger-mode");
    const select = async (label: string) => {
      await trigger.click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
      await page.getByRole("menu").waitFor({ state: "hidden" });
      await ready();
      await page.waitForFunction(
        (value) =>
          document
            .querySelector('[data-testid="acp-config-trigger-mode"]')
            ?.getAttribute("aria-label")
            ?.includes(value),
        label,
      );
    };
    // 重置上一个视口的偏好，再验证一次真实点击、Host 重启及页面恢复。
    await select("自动审核");
    assert.ok(
      (await page.evaluate(() => (window as any).__permissionRequests)).some(
        (item: any) =>
          item.command === "setConfigOption" &&
          item.input.value === "agent" &&
          item.input.rememberPermission === true,
      ),
      "Selecting an already effective mode must still persist the preference",
    );
    await select("完全访问");
    const requests = await page.evaluate(() => (window as any).__permissionRequests);
    assert.equal(
      requests.find((item: any) => item.command === "create").input.usePermissionPreference,
      true,
    );
    assert.equal(
      requests.findLast((item: any) => item.command === "setConfigOption").input.rememberPermission,
      true,
    );
    await fetch(`${endpoint}/restart`, { method: "POST" });
    await page.reload();
    await ready();
    assert.match((await trigger.getAttribute("aria-label"))!, /完全访问/);
    await page.evaluate(() => (window as any).__permissionWorkspace("workspace:two"));
    await ready();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="acp-config-trigger-mode"]')
        ?.getAttribute("aria-label")
        ?.includes("自动审核"),
    );
    await page.evaluate(() => (window as any).__permissionWorkspace("workspace:one"));
    await ready();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="acp-config-trigger-mode"]')
        ?.getAttribute("aria-label")
        ?.includes("完全访问"),
    );
    await select("自动审核");
    await fetch(`${endpoint}/restart`, { method: "POST" });
    await page.reload();
    await ready();
    assert.match((await trigger.getAttribute("aria-label"))!, /自动审核/);
    assert.deepEqual(
      errors,
      [],
      JSON.stringify({
        serverErrors,
        requests: await page.evaluate(() => (window as any).__permissionRequests),
      }),
    );
    await context.close();
    console.log(`ACP permission memory passed at ${width}px`);
  }
  assert.ok(calls.some((call) => call.value === "agent-full-access"));
} finally {
  await browser?.close();
  await service.disposeAllAndWait();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(directory, { recursive: true, force: true }),
  ]);
}
