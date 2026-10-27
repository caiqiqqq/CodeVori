import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__archive-workflow-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
const artifacts = await mkdtemp(join(tmpdir(), "archive-workflow-e2e-"));
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {WorkspaceArchivedProjectGroup} from '../../../ui/src/WorkspaceArchivedProjectGroup.tsx';
import {SavedWorkflowLaunchDialog} from '../../../ui/src/settings/saved-workflows/SavedWorkflowLaunchDialog.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
const entry={name:'many-parameters',description:'Workflow with many parameters',args:Object.fromEntries(Array.from({length:30},(_,i)=>['parameter'+i,{type:'string',default:'value'+i}]))};
function Fixture(){const [open,setOpen]=useState(false); const [selected,setSelected]=useState(''); const [submitted,setSubmitted]=useState(false);return <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><main className="min-h-screen bg-background text-foreground p-3 space-y-4">
{['local','remote'].map(key=><WorkspaceArchivedProjectGroup key={key} workspaceKey={key} workspacePath="/same/path/with/a/very/long/workspace/name" label="Same project" isRemote={key==='remote'} count={2}><li><button onClick={()=>setSelected(key+':native')}>native task</button></li><li><button onClick={()=>setSelected(key+':acp')}>ACP task</button></li></WorkspaceArchivedProjectGroup>)}
<button onClick={()=>setOpen(true)}>Open workflow</button><output data-selected={selected} data-submitted={submitted}/>
<SavedWorkflowLaunchDialog entry={open?entry as never:null} scope="project" projectLabel="Fixture" onOpenChange={setOpen} onSubmit={(_entry,args)=>{setSubmitted(Object.keys(args).length===30);setOpen(false)}}/>
</main></TooltipProvider></ZCodeIntlProvider>};createRoot(document.getElementById('root')!).render(<Fixture/>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193"}/${name}.html`);
  const groups = page.getByTestId("archive-project-group");
  await groups.first().waitFor();
  assert.equal(await groups.count(), 2);
  for (const group of await groups.all()) {
    assert.equal(await group.getByRole("button").first().getAttribute("aria-expanded"), "false");
    assert.equal(await group.getByRole("list").count(), 0);
    assert.ok(await group.getByTestId("archive-project-path").isVisible());
  }
  const first = groups.first().getByRole("button").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await groups.first().getByRole("button", { name: "ACP task", exact: true }).click();
  assert.equal(await page.locator("output").getAttribute("data-selected"), "local:acp");
  assert.equal(await groups.nth(1).getByRole("list").count(), 0);
  await groups.nth(1).getByRole("button").first().click();
  await groups.nth(1).getByRole("button", { name: "native task", exact: true }).click();
  assert.equal(await page.locator("output").getAttribute("data-selected"), "remote:native");
  await first.click();
  assert.equal(await groups.first().getByRole("list").count(), 0);

  for (const [width, height, dark] of [
    [1280, 800, false],
    [375, 812, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
    await page.getByRole("button", { name: "Open workflow" }).click();
    await page.getByLabel("parameter29", { exact: true }).waitFor({ state: "attached" });
    const submit = page.locator('button[type="submit"]');
    const bounds = await submit.boundingBox();
    assert.ok(
      bounds && bounds.y >= 0 && bounds.y + bounds.height <= height,
      `run button must stay within ${width}x${height}: ${JSON.stringify(bounds)}`,
    );
    await page.getByLabel("parameter29", { exact: true }).fill("last value");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `layout-${width}.png`), animations: "disabled" });
    await submit.click();
    await page.locator('output[data-submitted="true"]').waitFor({ state: "attached" });
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: archive defaults, keyboard, workspace isolation, ACP/native selection; 30 workflow arguments on desktop/mobile. ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
