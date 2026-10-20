// Real ACP hook + isolated Host. Synthetic adapter only; never calls a model.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { parseAcpElicitationForm, type AcpElicitationResponse } from "@zcode/shared";
import {
  createAcpService,
  type AcpConnectionFactory,
} from "../../services/src/acp/acpServiceImpl.js";

const directory = await mkdtemp(join(tmpdir(), "acp-input-e2e-"));
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-input-${process.pid}`;
const html = join(root, `${name}.html`),
  moduleFile = join(root, `${name}.tsx`);
const workspace = {
  workspacePath: "/synthetic/input-e2e",
  workspaceIdentity: "remote:input-e2e",
  remoteSessionId: "synthetic-attachment",
};
let callbacks!: Parameters<AcpConnectionFactory>[0];
let release!: () => void;
const answers: AcpElicitationResponse[] = [];
const answerWaiters = new Map<number, () => void>();
let requestNumber = 0,
  rejectAnswer = false;
const connect: AcpConnectionFactory = async (input) => {
  callbacks = input;
  return {
    sessionId: "native",
    configOptions: [],
    modeState: null,
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt() {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    async cancel() {
      release();
    },
    close() {},
  };
};
const service = createAcpService({ directory, connect });
const session = await service.create({ ...workspace, agent: "codex" });
await service.submitPrompt({ ...workspace, id: session.id, text: "fixture", commandId: "fixture" });
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
      case "/list":
        result = await service.list(input);
        break;
      case "/refresh":
        result = await service.read(input);
        break;
      case "/remove":
        result = null;
        break;
      case "/read":
        result = await service.read(input);
        break;
      case "/respondElicitation":
        if (rejectAnswer) {
          rejectAnswer = false;
          throw new Error("fixture retry");
        }
        await service.respondElicitation(input);
        result = null;
        break;
      case "/reject":
        rejectAnswer = true;
        result = null;
        break;
      case "/answers":
        result = answers;
        break;
      case "/form": {
        const fields = parseAcpElicitationForm({
          type: "object",
          required: ["choice"],
          properties: {
            choice: {
              type: "string",
              title: "归档确认",
              oneOf: [
                { const: "yes", title: "同意" },
                { const: "no", title: "不同意" },
              ],
            },
            note: { type: "string", title: "备注" },
            secret: { type: "string", title: "秘密", _meta: { codex: { isSecret: true } } },
            flag: { type: "boolean", title: "保留分支" },
            count: { type: "integer", title: "数量", minimum: 1 },
            tags: { type: "array", title: "标签", items: { type: "string", enum: ["a", "b"] } },
          },
        });
        void callbacks.onElicitation!({
          requestId: `input-${++requestNumber}`,
          message: "归档并删除工作树？",
          fields,
        }).then((answer) => {
          answers.push(answer);
          answerWaiters.get(answers.length - 1)?.();
          answerWaiters.delete(answers.length - 1);
        });
        result = null;
        break;
      }
      default:
        throw new Error("Unknown fixture operation");
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(error) }));
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
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {useAcpConversation} from '../../../ui/test/acpProjectionFixture.tsx';
    import {AcpConversationStatus} from '../../../ui/src/v4/AcpConversationContent.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import '../../../ui/src/styles.css';
    const listeners=new Set();
    const rpc=async(command,input={})=>{
      const response=await fetch(${JSON.stringify(endpoint)}+'/'+command,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      const value=await response.json();if(!response.ok)throw Error(value.error);return value;
    };
    window.__input=rpc;
    const service=Object.fromEntries(['list','refresh','remove','respondElicitation'].map(command=>[command,async input=>{
      const result=await rpc(command,input);
      if(command==='respondElicitation')await window.__sync();
      return result;
    }]));
    service.onDynamicSessionChanged=()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}};
    const target=${JSON.stringify({ ...workspace, id: session.id })};
    window.__sync=async()=>{const session=await rpc('read',target);for(const listener of listeners)listener({kind:'updated',session});};
    function Fixture(){const view=useAcpConversation(service as never,${JSON.stringify(workspace)},'codex');
      useEffect(()=>view.selectById('codex',target.id),[view.selectById]);
      return <div className="min-h-screen bg-background text-foreground"><div className="mx-auto max-w-3xl" data-testid="input-state" data-ready={view.ready&&!view.busy} data-error={view.error??''}>
        <AcpConversationStatus agent="codex" conversation={view} rows={[]}/></div></div>;}
    createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale="zh-CN"><Fixture/></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = `${process.env.ZCODE_E2E_BASE_URL || "http://127.0.0.1:5179"}/${name}.html`;
      await page.goto(url);
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="input-state"]')?.getAttribute("data-ready") ===
          "true",
      );
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const sync = async () => {
        await page.evaluate(() => (window as any).__sync());
      };
      const form = async () => {
        await page.evaluate(() => (window as any).__input("form"));
        await sync();
        await page.getByTestId("acp-elicitation").waitFor();
      };
      const before = answers.length;
      const awaitAnswer = async (index: number) => {
        // UI may clear its projection before the adapter callback completes; await that actual receipt.
        if (answers[index] === undefined)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Adapter did not receive the form response")),
              10000,
            );
            answerWaiters.set(index, () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        await sync();
        await page.getByTestId("acp-elicitation").waitFor({ state: "detached" });
      };
      await form();
      assert.equal(
        await page.getByRole("button", { name: "同意", exact: true }).getAttribute("aria-pressed"),
        "false",
      );
      assert.equal(
        await page.getByRole("button", { name: "提交", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "同意", exact: true }).click();
      await page.getByRole("textbox", { name: "备注" }).fill("保留记录");
      await page.locator('input[name="secret"]').fill("synthetic-private");
      assert.equal(await page.locator('input[name="secret"]').getAttribute("type"), "password");
      await page.getByRole("button", { name: "否", exact: true }).click();
      await page.getByRole("spinbutton", { name: "数量" }).fill("2");
      await page.getByRole("button", { name: "a", exact: true }).click();
      await page.screenshot({
        path: join(tmpdir(), `zcode-acp-form-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.evaluate(() => (window as any).__input("reject"));
      await page.getByRole("button", { name: "提交", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="input-state"]')
          ?.getAttribute("data-error")
          ?.includes("fixture retry"),
      );
      assert.equal(await page.getByRole("textbox", { name: "备注" }).inputValue(), "保留记录");
      await page.getByRole("button", { name: "提交", exact: true }).click();
      await awaitAnswer(before);
      assert.deepEqual(answers[before], {
        action: "accept",
        content: {
          choice: "yes",
          note: "保留记录",
          secret: "synthetic-private",
          flag: false,
          count: 2,
          tags: ["a"],
        },
      });
      await form();
      await page.reload();
      await page.getByTestId("acp-elicitation").waitFor();
      assert.equal(await page.getByRole("textbox", { name: "备注" }).inputValue(), "");
      await page.getByRole("button", { name: "拒绝", exact: true }).click();
      await awaitAnswer(before + 1);
      assert.deepEqual(answers[before + 1], { action: "decline" });
      await form();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await awaitAnswer(before + 2);
      assert.deepEqual(answers[before + 2], { action: "cancel" });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  console.log(
    "ACP form E2E passed: real hook/Host, 1280/375px, light/dark, typed answers/retry/reconnect/decline/cancel",
  );
} finally {
  await browser?.close();
  await service.stop({ ...workspace, id: session.id });
  await service.disposeAllAndWait();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(directory, { recursive: true, force: true }),
  ]);
}
