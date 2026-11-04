import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__image-annotation-${process.pid}`;
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
function Composer({identity,scope,enabled}:{identity:string,scope:string,enabled:boolean}){const api=useComposerAttachments({workspacePath:'/same',workspaceIdentity:identity,scopeId:scope,collectionOnly:true,disabled:!enabled,imageReferenceEnabled:enabled,listenAddToChatEvents:false});(window as any).__annotationFiles??={};(window as any).__annotationFiles[identity+':'+scope]=api.attachments;return <output data-composer={identity+':'+scope} data-count={api.attachments.length}>{api.attachments.map(a=>a.filename).join(',')}</output>}
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/${name}.html`);
  const openEditor = async () => {
    await page.getByRole("button", { name: "PNG preview", exact: true }).click();
    await page.getByRole("button", { name: "标注编辑", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("[data-image-preview-surface] img")?.naturalWidth === 240,
    );
  };
  const mark = async (tool) => {
    await page.locator(`[data-image-preview-tool="${tool}"]`).click();
    const box = await page.locator("[data-image-preview-surface]").boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 170, box.y + 110, { steps: 8 });
    await page.mouse.up();
  };
  await openEditor();
  await mark("rectangle");
  assert.equal(await page.locator("[data-annotation-id]").count(), 1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await page.locator("[data-annotation-id]").count(), 0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.equal(await page.locator("[data-annotation-id]").count(), 1);
  await page.locator('[data-image-preview-tool="text"]').click();
  const bounds = await page.locator("[data-image-preview-surface]").boundingBox();
  await page.mouse.click(bounds.x + 60, bounds.y + 60);
  await page.getByRole("textbox", { name: "标注文字" }).fill("验证标注");
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  assert.equal(await page.locator("[data-annotation-id]").count(), 2);
  await page.locator("[data-image-preview-save]").click();
  await page.locator('output[data-composer="remote-a:one"][data-count="1"]').waitFor();
  assert.equal(
    await page.locator('output[data-composer="remote-a:one"]').textContent(),
    "fixture-edited.png",
  );
  assert.equal(
    await page.locator('output[data-composer="remote-b:one"]').getAttribute("data-count"),
    "0",
  );
  const exported = await page.evaluate(async () => {
    const attachment = window.__annotationFiles["remote-a:one"][0];
    const bitmap = await createImageBitmap(attachment.file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 180 && pixels[i + 1] < 120 && pixels[i + 2] < 120) red++;
    return { width: bitmap.width, height: bitmap.height, type: attachment.file.type, red };
  });
  assert.deepEqual([exported.width, exported.height, exported.type], [240, 160, "image/png"]);
  assert.ok(exported.red > 20, "exported PNG must contain actual red annotation pixels");
  // 异步 canvas 导出尚未完成时切换 composer；只能拒绝，不能投到新会话。
  await openEditor();
  await mark("pen");
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      window.__releaseExport = () => original.call(this, callback, ...args);
    };
  });
  await page.locator("[data-image-preview-save]").click();
  await page.waitForFunction(() => typeof window.__releaseExport === "function");
  await page.evaluate(() =>
    [...document.querySelectorAll("main > button")]
      .find((el) => el.textContent === "Switch target")
      .click(),
  );
  await page.evaluate(() => window.__releaseExport());
  await page.getByText("图片保存失败，请重试", { exact: true }).waitFor();
  assert.equal(
    await page.locator('output[data-composer="remote-a:one"]').getAttribute("data-count"),
    "1",
  );
  assert.equal(
    await page.locator('output[data-composer="remote-b:one"]').getAttribute("data-count"),
    "0",
  );
  await page.screenshot({ path: join(artifacts, "annotation-session-isolation.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS annotation drawing, text, undo/redo, edited attachment and stale export rejection.",
    artifacts,
  );
} finally {
  releaseSlow?.();
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
