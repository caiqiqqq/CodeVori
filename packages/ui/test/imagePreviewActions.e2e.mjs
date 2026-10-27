import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__image-actions-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
const artifacts = await mkdtemp(join(tmpdir(), "image-actions-e2e-"));
const base = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193";
let browser;
let releaseSlow;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ImagePreviewDialog} from '../../../ui/src/components/ai-elements/image-preview-dialog.tsx';
import {ImageReferenceTargetProvider} from '../../../ui/src/hooks/useImageReference.tsx';
import {useComposerAttachments} from '../../../ui/src/v4/composer/useComposerAttachments.ts';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;canvas.getContext('2d')!.fillStyle='#3b82f6';canvas.getContext('2d')!.fillRect(0,0,240,160);
const png=canvas.toDataURL('image/png'),jpeg=canvas.toDataURL('image/jpeg'),svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>');
function Composer({identity,scope,enabled}:{identity:string,scope:string,enabled:boolean}){const api=useComposerAttachments({workspacePath:'/same',workspaceIdentity:identity,scopeId:scope,collectionOnly:true,disabled:!enabled,imageReferenceEnabled:enabled,listenAddToChatEvents:false});return <output data-composer={identity+':'+scope} data-count={api.attachments.length}>{api.attachments.map(a=>a.filename).join(',')}</output>}
function Fixture(){const [open,setOpen]=useState(false),[source,setSource]=useState(png),[target,setTarget]=useState(0),[hasTarget,setHasTarget]=useState(true);
const targets=[{workspaceKey:'remote-a',scopeId:'one'},{workspaceKey:'remote-b',scopeId:'one'},{workspaceKey:'remote-a',scopeId:'two'}];
return <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><ServiceProvider services={{fileService:{},promptAttachmentTransferService:{}} as never}><PlatformProvider platform={{} as never}><main className="min-h-screen bg-background text-foreground p-3">
{targets.map(t=><Composer key={t.workspaceKey+':'+t.scopeId} identity={t.workspaceKey} scope={t.scopeId} enabled={hasTarget&&targets[target]===t}/>)}
<button onClick={()=>{setSource(png);setOpen(true)}}>PNG preview</button><button onClick={()=>{setSource(jpeg);setOpen(true)}}>JPEG preview</button>
<button onClick={()=>{setSource(svg);setOpen(true)}}>SVG preview</button><button onClick={()=>{setSource('/slow-image.png');setOpen(true)}}>Slow preview</button>
<button onClick={()=>setTarget((target+1)%3)}>Switch target</button><button onClick={()=>setHasTarget(!hasTarget)}>Toggle target</button>
<ImageReferenceTargetProvider target={hasTarget?targets[target]:null}><ImagePreviewDialog dialogTestId="image-preview" initialIndex={0} items={[{alt:'fixture image',filename:source===jpeg?'fixture.jpg':'fixture.png',src:source}]} open={open} onOpenChange={setOpen}/></ImageReferenceTargetProvider>
</main></PlatformProvider></ServiceProvider></TooltipProvider></ZCodeIntlProvider>};createRoot(document.getElementById('root')!).render(<Fixture/>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/${name}.html`);
  await page.getByRole("button", { name: "PNG preview", exact: true }).click();
  await page.getByRole("button", { name: "复制图片", exact: true }).click();
  await page.waitForFunction(async () =>
    (await navigator.clipboard.read()).some((item) => item.types.includes("image/png")),
  );
  await page.getByRole("button", { name: "引用到对话", exact: true }).click();
  await page
    .locator('output[data-composer="remote-a:one"][data-count="1"]')
    .waitFor({ state: "attached" });
  assert.equal(
    await page.locator('output[data-composer="remote-b:one"]').getAttribute("data-count"),
    "0",
  );
  assert.equal(
    await page.locator('output[data-composer="remote-a:two"]').getAttribute("data-count"),
    "0",
  );
  await page.getByRole("button", { name: "Switch target", exact: true }).click();
  await page.getByRole("button", { name: "JPEG preview", exact: true }).click();
  await page.getByRole("button", { name: "复制图片", exact: true }).click();
  await page.waitForFunction(async () =>
    (await navigator.clipboard.read()).some((item) => item.types.includes("image/png")),
  );
  await page.getByRole("button", { name: "引用到对话", exact: true }).click();
  await page
    .locator('output[data-composer="remote-b:one"][data-count="1"]')
    .waitFor({ state: "attached" });
  assert.equal(
    await page.locator('output[data-composer="remote-b:one"]').textContent(),
    "fixture.jpg",
  );

  await page.getByRole("button", { name: "SVG preview", exact: true }).click();
  await page.getByRole("button", { name: "复制图片", exact: true }).click();
  await page.waitForFunction(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes("image/png")) continue;
      const image = await createImageBitmap(await item.getType("image/png"));
      const correct = image.width === 32 && image.height === 24;
      image.close();
      if (correct) return true;
    }
    return false;
  });
  await page.evaluate(() => {
    navigator.clipboard.write = async () => {
      throw new Error("fixture permission denied");
    };
  });
  await page.getByRole("button", { name: "复制图片", exact: true }).click();
  await page.getByText("复制图片失败", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  let routeStarted;
  const started = new Promise((resolve) => {
    routeStarted = resolve;
  });
  const slow = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const pngBytes = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2;
      c.height = 2;
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  await page.route("**/slow-image.png", async (route) => {
    if (route.request().resourceType() !== "fetch")
      return route.fulfill({ body: pngBytes, contentType: "image/png" });
    routeStarted();
    await slow;
    await route.fulfill({ body: pngBytes, contentType: "image/png" });
  });
  await page.getByRole("button", { name: "Slow preview", exact: true }).click();
  await page.getByRole("button", { name: "引用到对话", exact: true }).click();
  await started;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch target", exact: true }).click();
  releaseSlow();
  await page
    .getByText("无法引用图片，请检查当前会话及附件数量和大小限制", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('output[data-composer="remote-b:one"]').getAttribute("data-count"),
    "1",
  );
  assert.equal(
    await page.locator('output[data-composer="remote-a:two"]').getAttribute("data-count"),
    "0",
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "PNG preview", exact: true }).click();
  for (const name of ["复制图片", "引用到对话", "下载图片"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 812,
      name,
    );
  }
  await page.screenshot({ path: join(artifacts, "mobile-dark.png"), animations: "disabled" });
  for (let count = 1; count <= 8; count++) {
    await page.getByRole("button", { name: "引用到对话", exact: true }).click();
    await page
      .locator(`output[data-composer="remote-a:two"][data-count="${count}"]`)
      .waitFor({ state: "attached" });
    await page.getByRole("button", { name: "PNG preview", exact: true }).click();
  }
  await page.getByRole("button", { name: "引用到对话", exact: true }).click();
  await page
    .getByText("无法引用图片，请检查当前会话及附件数量和大小限制", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('output[data-composer="remote-a:two"]').getAttribute("data-count"),
    "8",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle target", exact: true }).click();
  await page.getByRole("button", { name: "PNG preview", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "引用到对话", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: PNG/JPEG/SVG clipboard, permission failure, scoped admission, stale target and attachment limit rejection, mobile actions. ${artifacts}`,
  );
} finally {
  releaseSlow?.();
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
