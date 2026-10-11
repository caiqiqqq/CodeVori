// Synthetic content/Hosts only; exercises the actual renderer and Streamdown cache.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-markdown-isolation-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-markdown-isolation-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepositoryMarkdown} from '../../../ui/src/repository-panel/RepositoryMarkdown.tsx';
    import {MessageResponse} from '../../../ui/src/components/ai-elements/message.tsx';
    import {resolveForgeContentUrl} from '../../../ui/src/lib/forgeContent.ts';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pending:[],externals:[],delay:false,failNext:false};window.__isolation=state;
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#16874b';ctx.fillRect(0,0,80,40);
    const dataBase64=canvas.toDataURL('image/png').split(',')[1];state.png=dataBase64;
    const preview={mediaType:'image/png',dataBase64,totalBytes:atob(dataBase64).length};
    const staleCanvas=document.createElement('canvas');staleCanvas.width=1;staleCanvas.height=1;
    const staleBase64=staleCanvas.toDataURL('image/png').split(',')[1];
    const stalePreview={mediaType:'image/png',dataBase64:staleBase64,totalBytes:atob(staleBase64).length};
    const cases=[
      {provider:'github',url:'https://github.com/team/project'},
      {provider:'github',url:'https://enterprise.example.invalid/git/team/project'},
      {provider:'gitlab',url:'https://gitlab.example.invalid/git/team/sub/project'},
      {provider:'gitlab',url:'https://gitlab.example.invalid/git/team/other'},
      {provider:'gitea',url:'https://gitea.example.invalid/git/team/project'},
      {provider:'gitea',url:'https://forgejo.example.invalid:8443/forge/team/project'},
    ];
    state.cases=cases;
    const paths=['/user-attachments/assets/12345678-1234-1234-1234-123456789abc','/git/user-attachments/assets/12345678-1234-1234-1234-123456789abc','/uploads/0123456789abcdef0123456789abcdef/image.png','/uploads/0123456789abcdef0123456789abcdef/image.png','/git/team/project/issues/7/attachments/12345678-1234-1234-1234-123456789abc','/forge/attachments/12345678-1234-1234-1234-123456789abc'];
    function Fixture(){const [selection,setSelection]=useState({index:0,host:'A',account:'account-A',item:7,draft:false});const [theme,setTheme]=useState<any>('zai-light');state.select=(value:any)=>setSelection({...selection,...value});state.setTheme=(value:any)=>{applyTheme(value);setTheme(value)};
      const {index,host,account,item,draft}=selection;const repository={...cases[index],key:host+':'+index,name:'team/project',accountId:account,accountUsername:'tester'};
      const request={workspacePath:'/synthetic/'+host,workspaceIdentity:host,repositoryKey:repository.key,accountId:account,kind:'issue',number:item};
      const itemUrl=repository.url+(repository.provider==='gitlab'?'/-/issues/':'/issues/')+item;
      const source=draft?'./image.png':paths[index];const expected=resolveForgeContentUrl(repository,draft?repository.url:itemUrl,source);state.expected=expected;state.current=selection;
      const service:any={async readForgeImage(r:any){state.calls.push({...r,host});if(state.failNext){state.failNext=false;throw Error('FORGE_AUTHENTICATION')}if(state.delay){state.delay=false;return new Promise(resolve=>state.pending.push(()=>resolve(stalePreview)))}return preview;},async authenticateForgeImage(){throw Error('Unexpected sign-in')}};
      const markdown='![Markdown image]('+source+')\\n\\n<img src="'+source+'" alt="HTML image" />\\n\\n[Markdown link](./details)\\n\\n<a href="./details">HTML link</a>\\n\\n[blocked](javascript:alert(1))';
      const onOpen=(url:string)=>state.externals.push(url);
      const content=draft?<MessageResponse theme={theme} codePreviewSettings={DEFAULT_CODE_PREVIEW_SETTINGS} onOpenExternalUrl={onOpen} webContent={{resolveUrl:(url:string)=>resolveForgeContentUrl(repository,repository.url,url),renderImage:(props:any)=><img data-testid="draft-image" src={props.src}/>}}>{markdown}</MessageResponse>:<RepositoryMarkdown context={{repository,request,gitService:service,itemUrl,active:true,onOpen}} theme={theme} codePreviewSettings={DEFAULT_CODE_PREVIEW_SETTINGS}>{markdown}</RepositoryMarkdown>;
      return <div data-testid="content" className="min-h-dvh bg-background p-4 text-foreground">{content}</div>;
    }
    const platform:any={openExternal:(url:string)=>state.externals.push(url),readFile(){throw Error('Unexpected local IO')}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = [];
  const reads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    /https:\/\/(?:github\.com|[^/]+\.example\.invalid)(?::\d+)?\//,
    async (route) => {
      reads.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(await page.evaluate(() => window.__isolation.png), "base64"),
      });
    },
  );
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  await page.waitForFunction(() => typeof window.__isolation?.setTheme === "function");
  const content = page.getByTestId("content");
  const verify = async (index, host = "A", account = "account-A", item = 7) => {
    await page.evaluate((selection) => window.__isolation.select(selection), {
      index,
      host,
      account,
      item,
      draft: false,
    });
    await page.waitForFunction(
      (selection) =>
        Object.entries(selection).every(
          ([key, value]) => window.__isolation.current[key] === value,
        ),
      { index, host, account, item, draft: false },
    );
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[data-testid="repository-inline-image"]')];
      return images.length === 2 && images.every((img) => img.naturalWidth === 80);
    });
    const expected = await page.evaluate(() => window.__isolation.expected);
    const images = content.getByTestId("repository-inline-image");
    const sources = await images.evaluateAll((imgs) => imgs.map((img) => img.src));
    assert.ok(sources.every((src) => src.startsWith("blob:")));
    const calls = await page.evaluate(() => window.__isolation.calls.slice(-2));
    assert.ok(
      calls.every(
        (call) =>
          call.url === expected &&
          call.host === host &&
          call.accountId === account &&
          call.repositoryKey === host + ":" + index,
      ),
    );
    assert.deepEqual(
      await images.first().evaluate((img) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      }),
      [22, 135, 75, 255],
    );
    assert.deepEqual(
      await images.evaluateAll((imgs) => imgs.map((img) => img.naturalWidth / img.naturalHeight)),
      [2, 2],
    );
    for (const label of ["Markdown link", "HTML link"]) {
      await content.getByRole("button", { name: label, exact: true }).click();
      const current = await page.evaluate(() => window.__isolation.externals.at(-1));
      const repository = await page.evaluate((i) => window.__isolation.cases[i], index);
      assert.equal(
        current,
        new URL(
          "./details",
          repository.url + (repository.provider === "gitlab" ? "/-/issues/" : "/issues/") + item,
        ).href,
      );
    }
  };
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((value) => window.__isolation.setTheme(value), theme);
      for (const index of [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]) await verify(index);
      await page.screenshot({ path: join(artifacts, `isolation-${width}-${theme}.png`) });
    }
  }
  for (const index of [1, 4, 5]) {
    await page.evaluate((index) => {
      window.__isolation.failNext = true;
      window.__isolation.select({ index, host: "retry-" + index });
    }, index);
    await content.getByRole("alert").waitFor();
    assert.equal(await content.getByRole("button", { name: "登录 GitLab" }).count(), 0);
    await content.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[data-testid="repository-inline-image"]')];
      return images.length === 2 && images.every((img) => img.naturalWidth === 80);
    });
    await content.getByRole("button", { name: "预览图片", exact: true }).first().click();
    await page.getByTestId("repository-image-preview").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("repository-image-preview").waitFor({ state: "hidden" });
  }
  for (const index of [1, 2, 4, 5]) {
    await verify(index, "B", "account-B", 8);
    await verify(index, "A", "account-C", 9);
    await page.evaluate((index) => {
      window.__isolation.delay = true;
      window.__isolation.select({ index, host: "old" });
    }, index);
    await page.waitForFunction(() => window.__isolation.pending.length > 0);
    await verify(index, "new", "account-new", 10);
    await page.evaluate(() => window.__isolation.pending.shift()());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.deepEqual(
      await content
        .getByTestId("repository-inline-image")
        .evaluateAll((imgs) => imgs.map((img) => img.naturalWidth)),
      [80, 80],
      "The old Host's 1px response must not replace the current Host's images",
    );
  }
  await page.evaluate(() => window.__isolation.select({ index: 1, draft: true }));
  await page.getByTestId("draft-image").first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="draft-image"]')].every(
      (img) => img.naturalWidth === 80,
    ),
  );
  const publicUrl = await page.evaluate(() => window.__isolation.expected);
  assert.ok(
    reads.includes(publicUrl),
    "Public draft images retain credential-free browser rendering",
  );
  await verify(3, "A", "account-A", 7);
  assert.equal(
    reads.filter((url) => /\/user-attachments\/|\/uploads\/|\/attachments\//.test(url)).length,
    0,
    "Private attachments always use the bound Host",
  );
  assert.deepEqual(errors, []);
  process.stdout.write(`Repository Markdown isolation E2E passed. Screenshots: ${artifacts}\n`);
} catch (error) {
  process.stderr.write(`Repository Markdown isolation diagnostics: ${artifacts}\n`);
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
