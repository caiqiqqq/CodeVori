// Real GitPane + repository hook; synthetic Host reads, no Agent or Git writes.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__git-review-sources-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-git-review-sources-"));
let browser;
let page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useGitRepository} from '../../../ui/src/hooks/useGitRepository.ts';
    import {GitPane} from '../../../ui/src/GitPane.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    let mode='unstaged',resolveSlow;
    const services={gitService:{refresh:async()=>{
      if(mode==='error')throw new Error('synthetic Git read failed');
      if(mode==='slow')await new Promise(resolve=>resolveSlow=resolve);
      const change={path:'CommandServiceImpl.java',repoRelativePath:'CommandServiceImpl.java',workspaceRelativePath:'CommandServiceImpl.java',kind:'modified',section:mode==='staged'?'staged':'unstaged',added:mode==='binary'?0:56,removed:0,isStaged:mode==='staged',isUntracked:false,isConflicted:false};
      return {summary:{workspacePath:'/fixture',repoRoot:'/fixture',autoRefreshWatchPaths:[],isGitAvailable:mode!=='unavailable',isRepository:mode!=='non-repository'},unstagedChanges:['unstaged','binary','slow'].includes(mode)?[change]:[],stagedChanges:mode==='staged'?[change]:[]};
    }}};
    function Fixture(){
      const [source,setSource]=useState('staged'),[version,setVersion]=useState(0),[locale,setLocale]=useState('zh-CN');
      const git=useGitRepository({workspacePath:'/fixture',activeTaskId:null,includeExtendedData:true,refreshToken:version});
      window.__review={source,setSource,setLocale,applyTheme,setMode:value=>{mode=value;setVersion(v=>v+1)},resolveSlow:()=>resolveSlow?.()};
      return <ZCodeIntlProvider key={locale} initialLocale={locale}><div className='h-dvh'><GitPane workspacePath='/fixture' gitState={git} selectedSourceId={source} onSelectSource={setSource} onClose={()=>{}} onRefresh={()=>setVersion(v=>v+1)} fileChangeFindActiveIndex={0} fileChangeFindNavigationRequestId={0} fileChangeFindQuery='' onFileChangeFindMatchCountChange={()=>{}}/></div></ZCodeIntlProvider>;
    }
    createRoot(document.getElementById('root')).render(<StoreProvider broadcastService={{onMessage:()=>({dispose:()=>{}}),send:async()=>{}}}><TabStoreProvider><ServiceProvider services={services}><PlatformProvider platform={{isWeb:true}}><TooltipProvider><Fixture/></TooltipProvider></PlatformProvider></ServiceProvider></TabStoreProvider></StoreProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${name}.html`, { waitUntil: "domcontentloaded" });
  const switchToUnstaged = () =>
    page.getByRole("button", { name: "查看未暂存改动（1）", exact: true });
  await switchToUnstaged().waitFor({ timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__review.source), "staged");
  assert.match(await page.getByRole("combobox").innerText(), /已暂存\s*0/);
  assert.match(await page.locator("body").innerText(), /未暂存.*1/);
  await page.screenshot({ path: join(artifacts, "staged-empty.png") });
  await switchToUnstaged().click();
  await page.getByText("CommandServiceImpl.java", { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => window.__review.source), "unstaged");
  await page.getByRole("combobox").click();
  assert.match(await page.getByRole("option", { name: /未暂存/ }).innerText(), /未暂存\s*1/);
  assert.match(await page.getByRole("option", { name: /已暂存/ }).innerText(), /已暂存\s*0/);
  await page.keyboard.press("Escape");
  console.log(
    "PASS: issue #158 staged-empty state points to the existing unstaged file; source counts are visible",
  );

  await page.evaluate(() => window.__review.setMode("staged"));
  await page.getByRole("button", { name: "查看已暂存改动（1）", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__review.source), "unstaged");
  await page.getByRole("button", { name: "查看已暂存改动（1）", exact: true }).click();
  await page.getByText("CommandServiceImpl.java", { exact: true }).first().waitFor();
  await page.evaluate(() => window.__review.setMode("binary"));
  await switchToUnstaged().waitFor();
  console.log(
    "PASS: reverse staged suggestion and zero-line file changes work without automatic selection",
  );

  for (const source of ["branch", "last-turn"]) {
    await page.evaluate((source) => window.__review.setSource(source), source);
    await page.waitForFunction((source) => window.__review.source === source, source);
    assert.equal(await page.getByRole("button", { name: /查看.*改动/ }).count(), 0);
  }
  await page.evaluate(() => window.__review.setSource("staged"));
  await switchToUnstaged().waitFor();
  await page.evaluate(() => window.__review.setMode("slow"));
  await page.getByText("加载中...", { exact: true }).waitFor();
  assert.equal(await switchToUnstaged().count(), 0);
  await page.evaluate(() => window.__review.resolveSlow());
  await switchToUnstaged().waitFor();
  for (const mode of ["clean", "error", "non-repository", "unavailable"]) {
    await page.evaluate((mode) => window.__review.setMode(mode), mode);
    const expected = {
      clean: "当前来源下没有可展示的改动",
      error: "无法加载 Git 改动",
      "non-repository": "当前 workspace 不在 Git 仓库中",
      unavailable: "当前环境没有可用的 Git",
    }[mode];
    await page.getByText(expected, { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /查看.*改动/ }).count(), 0);
  }
  console.log(
    "PASS: clean/error/loading/non-repository/unavailable and historical sources keep their own empty states",
  );

  await page.evaluate(() => window.__review.setMode("binary"));
  await switchToUnstaged().waitFor();
  await page.evaluate(() => window.__review.setLocale("en-US"));
  await page.getByRole("button", { name: "View Unstaged changes (1)", exact: true }).waitFor();
  await page.evaluate(() => window.__review.setLocale("zh-CN"));
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 700 });
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__review.applyTheme(theme), theme);
      await switchToUnstaged().waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: join(artifacts, `${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: English/Chinese, desktop/mobile and light/dark layouts; screenshots: ${artifacts}`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  console.error("Page errors:", errors, "Screenshots:", artifacts);
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
