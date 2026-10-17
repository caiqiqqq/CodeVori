// Fake Host only: no account, repository writes or model calls.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__issues-mcp-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const shots = await mkdtemp(join(tmpdir(), "zcode-issues-mcp-ui-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {BuiltInIssuesMcp, isBuiltInIssuesMcpVisible} from '../../../ui/src/settings/BuiltInIssuesMcp.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import '../../../ui/src/styles.css';
      const state=window.__issues={enabled:true,reject:false,calls:[],search:'',remote:false};
      const services={settingService:{get:async()=>({forgeIssuesMcpEnabled:state.enabled}),update:async patch=>{
        state.calls.push(patch);
        if(state.reject){state.reject=false;throw Error('fixture save failure');}
        state.enabled=patch.forgeIssuesMcpEnabled;
      }}};
      const platform={isWeb:true,isLinux:true,isMacOS:false,isWindows:false};
      function Fixture(){
        const [key,setKey]=useState(0);
        const [search,setSearch]=useState('');
        const [scope,setScope]=useState({scope:'user',remote:false});
        state.remount=()=>setKey(x=>x+1);
        state.search=value=>setSearch(value);
        state.scope=value=>setScope({scope:'user',remote:false,...value});
        return <PlatformProvider platform={platform}><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN">
          <main className="min-h-screen bg-background text-foreground"><div style={{maxWidth:900,margin:'0 auto',padding:16}}>
            {isBuiltInIssuesMcpVisible({...scope,query:search,title:'议题管理'})?<BuiltInIssuesMcp key={key} services={services}/>:null}
          </div></main>
        </ZCodeIntlProvider></ServiceProvider></PlatformProvider>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 700 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.setDefaultTimeout(15_000);
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
      }, theme);
      const row = page.getByTestId("built-in-issues-mcp");
      const toggle = row.getByRole("switch", { name: "启用议题管理 MCP" });
      await toggle.waitFor();
      await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
      assert.equal(await toggle.getAttribute("aria-checked"), "true");
      await toggle.click();
      await page.waitForFunction(
        () =>
          window.__issues.enabled === false &&
          document.querySelector('[role="switch"]').getAttribute("aria-checked") === "false" &&
          !document.querySelector('[role="switch"]').disabled,
      );
      await page.evaluate(() => window.__issues.remount());
      await page.waitForFunction(
        () =>
          document.querySelector('[role="switch"]').getAttribute("aria-checked") === "false" &&
          !document.querySelector('[role="switch"]').disabled,
      );
      await page.evaluate(() => {
        window.__issues.reject = true;
      });
      await toggle.click();
      await row.getByRole("alert").waitFor();
      assert.equal(
        await toggle.getAttribute("aria-checked"),
        "false",
        "failed save retains persisted setting",
      );
      await toggle.focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () =>
          window.__issues.enabled === true &&
          document.querySelector('[role="switch"]').getAttribute("aria-checked") === "true",
      );
      assert.equal(await row.getByRole("alert").count(), 0);
      const box = await toggle.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.equal(await row.getByRole("button", { name: /删除|编辑/ }).count(), 0);
      await row.screenshot({ path: join(shots, `issues-${width}-${theme}.png`) });
      await page.evaluate(() => window.__issues.search("GitLab"));
      await row.waitFor();
      await page.evaluate(() => window.__issues.search("unrelated-query"));
      await row.waitFor({ state: "detached" });
      for (const scope of [
        { remote: true },
        { scope: "project" },
        { workspaceIdentity: "remote:fixture" },
        { remoteSessionId: "attachment" },
      ]) {
        await page.evaluate((scope) => {
          window.__issues.search("");
          window.__issues.scope(scope);
        }, scope);
        await row.waitFor({ state: "detached" });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    `PASS: built-in issue MCP settings, persistence, failure rollback, keyboard, search, 1280/375 light/dark. Screenshots: ${shots}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
