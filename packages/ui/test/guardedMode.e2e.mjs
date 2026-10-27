import assert from "node:assert/strict";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { buildProtocolPermissionOptions } from "../../../apps/zcode-cli/packages/bootstrap/src/permission-options.ts";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__guarded-${process.pid}`;
const files = [join(root, name + ".html"), join(root, name + ".tsx")];
const artifacts = await mkdtemp(join(tmpdir(), "guarded-e2e-"));
let browser;
const request = {
  type: "permission_request",
  taskId: "fixture",
  traceId: "fixture",
  kind: "execute",
  description: "Dangerous command requires approval",
  raw: { toolName: "Bash", input: { command: "rm -rf fixture" } },
  requestId: "guarded-request",
  toolCallId: "guarded-call",
  toolName: "Bash",
  reason: "Dangerous command requires approval",
  input: { command: "rm -rf fixture" },
  options: buildProtocolPermissionOptions({
    toolName: "Bash",
    input: { command: "rm -rf fixture" },
    optionsPolicy: "no-always-allow",
  }),
};
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ConfigSelect} from '../../../ui/src/chat-input-toolbar/display.tsx';
import {PermissionDialog} from '../../../ui/src/PermissionDialog.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {getZCodeAgentModeSelectOptions} from '@zcode/shared';import '../../../ui/src/styles.css';
const request=${JSON.stringify(request)};
function Fixture(){const [mode,setMode]=useState('build');const [answer,setAnswer]=useState('');return <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><main className="min-h-screen bg-background text-foreground p-3"><ConfigSelect provider="glm" restoreFocusSelector={null} option={{id:'mode',name:'Mode',category:'mode',type:'select',currentValue:mode,options:getZCodeAgentModeSelectOptions()}} tooltipTitle="Mode" onValueChange={setMode}/><output data-mode={mode}>{mode}</output><PermissionDialog request={request as never} workspacePath="/fixture" provider="glm" onRespond={(_id,option)=>setAnswer(option.kind)}/><output data-answer={answer}>{answer}</output></main></TooltipProvider></ZCodeIntlProvider>};createRoot(document.getElementById('root')!).render(<Fixture/>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log(e.stack);
  });
  page.on("response", async (r) => {
    if (r.status() >= 400) console.log(r.status(), r.url(), (await r.text()).slice(0, 1000));
  });
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187"}/${name}.html`);
  await page.getByRole("combobox").click();
  await page.getByRole("option").filter({ hasText: "自主模式" }).click();
  await page.locator('output[data-mode="guarded"]').waitFor();
  assert.equal(await page.getByText(/始终允许/).count(), 0);
  await page.getByRole("option", { name: /允许/ }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.locator('output[data-answer="allow_once"]').waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: join(artifacts, "mobile-dark.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    `PASS guarded selector and one-time permission UI, desktop/mobile dark. ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
