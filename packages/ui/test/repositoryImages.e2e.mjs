// Synthetic Host only. Never uploads to a real forge or creates a remote issue.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-images-${process.pid}`;
const html = join(root, `${name}.html`);
const fixture = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-repository-images-"));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
  "base64",
);
let browser, page;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    fixture,
    `
    import React, {useState, useMemo} from 'react';
    import {createRoot} from 'react-dom/client';
    import {NewIssueDialog} from '../../../ui/src/repository-panel/NewIssueDialog.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pending:[],delay:true,fail:false,supported:true,requiresWebLogin:true};window.__images=state;
    const services:any={};
    for(const host of ['A','B']) services[host]={
      async getForgeIssueOptions(){return {labels:{items:[],error:null},assignees:{items:[],error:null},milestones:{items:[],error:null}}},
      async getForgeImageUploadCapability(){return {supported:state.supported,requiresWebLogin:state.requiresWebLogin,reason:state.supported?undefined:'web-login-unavailable'}},
      async uploadForgeImage(request:any){state.calls.push({host,...request});if(state.fail){const failure=state.fail;state.fail=false;throw new Error(typeof failure==='string'?failure:'FORGE_NETWORK')}const url='https://github.com/user-attachments/assets/'+request.requestId;return state.delay?new Promise(resolve=>state.pending.push(()=>resolve({url}))):{url}},
    };
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    function Fixture(){
      const [host,setHost]=useState('A');const [present,setPresent]=useState(true);const [active,setActive]=useState(true);const [version,setVersion]=useState(0);const [theme,setTheme]=useState<any>('zai-light');
      state.switchHost=setHost;state.setActive=setActive;state.remount=()=>setVersion(v=>v+1);state.setTheme=(value:any)=>{applyTheme(value);setTheme(value)};
      const target=useMemo(()=>({workspacePath:'/synthetic/'+host,workspaceIdentity:'identity-'+host,repositoryKey:host,accountId:'3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01'}),[host]);
      const repository:any={key:host,name:'synthetic/project',provider:'github',url:'https://github.com/synthetic/project',accountId:target.accountId,accountUsername:'tester'};
      return present?<NewIssueDialog key={host+version} open={active} repository={repository} target={target} gitService={services[host]} theme={theme} busy={false} error={null} onOpen={(url:string)=>state.external=url} onClose={()=>setPresent(false)} onSubmit={async(draft:any)=>{state.created=draft;setPresent(false)}}/>:<button onClick={()=>setPresent(true)}>重新打开</button>;
    }
    applyTheme('zai-light');
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><Fixture/></StoreProvider></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const dialog = page.getByTestId("repository-new-issue");
  const title = dialog.getByRole("textbox", { name: "标题", exact: true });
  const body = dialog.getByRole("textbox", { name: "描述", exact: true });
  const create = dialog.getByRole("button", { name: "创建", exact: true });
  const file = (name) => ({ name, mimeType: "image/png", buffer: png });
  const choose = async (name) => {
    await dialog.getByRole("button", { name: "添加图片", exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="repository-issue-images"] input').disabled,
    );
    await dialog.locator('input[type="file"]').setInputFiles(file(name));
  };
  const release = async () => {
    await page.waitForFunction(() => window.__images.pending.length > 0);
    await page.evaluate(() => window.__images.pending.shift()());
  };
  await title.fill("带截图的议题");
  await body.fill("原始描述");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await dialog
    .getByText("请选择不超过 4 MB 的 PNG、JPEG、GIF 或 WebP 图片", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__images.calls.length), 0);
  await choose("first.png");
  assert.equal(await create.isDisabled(), true);
  const desktopUploadHint =
    "手机上无法操作电脑的登录窗口；如需直接在手机上添加图片，可打开仓库网页。草稿和图片不会自动带入网页。";
  const webButton = dialog.getByRole("button", { name: "打开仓库网页", exact: true });
  await dialog.getByText(desktopUploadHint, { exact: true }).waitFor();
  await dialog.getByText("正在通过电脑上传图片…", { exact: true }).waitFor();
  await webButton.click();
  assert.equal(
    await page.evaluate(() => window.__images.external),
    "https://github.com/synthetic/project",
  );
  assert.equal(await body.inputValue(), "原始描述");
  assert.equal(await title.inputValue(), "带截图的议题");
  assert.equal(await dialog.getByTestId("repository-draft-image").count(), 1);
  assert.equal(await page.evaluate(() => window.__images.calls.length), 1);
  assert.equal(await page.evaluate(() => window.__images.created), undefined);
  await body.fill("上传期间继续编辑的描述");
  await release();
  await dialog.getByText("图片已上传", { exact: true }).waitFor();
  assert.match(await body.inputValue(), /^上传期间继续编辑的描述\n\n!\[first.png\]/);
  await dialog.getByRole("tab", { name: "预览", exact: true }).click();
  await dialog.getByTestId("repository-issue-preview").locator("img").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="repository-issue-preview"] img')?.naturalWidth === 1,
  );
  await dialog.getByRole("tab", { name: "编辑", exact: true }).click();
  await dialog.getByRole("button", { name: "移除图片 first.png", exact: true }).click();
  assert.equal((await body.inputValue()).includes("user-attachments"), false);

  await page.evaluate(() => {
    window.__images.fail = "FORGE_MEDIA_AUTHENTICATION";
  });
  await choose("retry.png");
  await dialog.getByRole("alert").waitFor();
  const authError =
    "尚未确认 GitHub 登录身份，请重试并在登录窗口使用当前仓库绑定的 GitHub 账号登录";
  await dialog.getByText(authError, { exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByText("网页登录账号与仓库绑定账号不一致，请使用对应账号登录", { exact: true })
      .count(),
    0,
  );
  for (const width of [1120, 375]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((value) => window.__images.setTheme(value), theme);
      await page.waitForFunction(
        (value) => document.documentElement.classList.contains(`theme-${value}`),
        theme,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      assert.equal(await dialog.getByText(authError, { exact: true }).isVisible(), true);
      assert.equal(await dialog.getByText(desktopUploadHint, { exact: true }).isVisible(), true);
      await webButton.click();
      assert.equal(await body.inputValue(), "上传期间继续编辑的描述\n\n");
      assert.equal(await create.isDisabled(), true);
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: join(artifacts, `github-sign-in-${theme}-${width}.png`) });
    }
  }
  assert.equal(await create.isDisabled(), true);
  const failedId = await page.evaluate(() => window.__images.calls.at(-1).requestId);
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await release();
  await dialog.getByText("图片已上传", { exact: true }).waitFor();
  assert.notEqual(await page.evaluate(() => window.__images.calls.at(-1).requestId), failedId);

  await body.evaluate((element, base64) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "paste.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, png.toString("base64"));
  await release();
  await page.waitForFunction(() =>
    document.querySelector("#repository-issue-body").value.includes("![paste.png]"),
  );
  await body.evaluate((element, base64) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "drop.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, png.toString("base64"));
  await page.evaluate(() => window.__images.setActive(false));
  await release();
  await page.evaluate(() => window.__images.setActive(true));
  await page.waitForFunction(() =>
    document.querySelector("#repository-issue-body").value.includes("![drop.png]"),
  );
  const callsBeforeLimit = await page.evaluate(() => window.__images.calls.length);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(Array.from({ length: 6 }, (_, index) => file(`extra-${index}.png`)));
  await dialog.getByText("每个议题最多添加 8 张图片", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__images.calls.length), callsBeforeLimit);
  assert.equal(await dialog.getByTestId("repository-draft-image").count(), 3);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => window.__images.setTheme(theme), theme);
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      assert.ok(
        await page.evaluate(
          (theme) => document.documentElement.classList.contains(`theme-${theme}`),
          theme,
        ),
      );
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        `${theme}/${width} overflow`,
      );
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`) });
    }
  }
  await create.click();
  const created = await page.evaluate(() => window.__images.created);
  assert.equal(created.title, "带截图的议题");
  assert.match(created.body, /!\[retry.png\].*!\[paste.png\].*!\[drop.png\]/s);
  await page.getByRole("button", { name: "重新打开" }).click();
  await choose("old-host.png");
  await page.waitForFunction(() => window.__images.pending.length === 1);
  await page.evaluate(() => window.__images.switchHost("B"));
  await title.fill("新 Host 草稿");
  await body.fill("新正文");
  await release();
  assert.equal(await body.inputValue(), "新正文");
  assert.equal(await dialog.getByTestId("repository-draft-image").count(), 0);
  await page.evaluate(() => {
    window.__images.supported = false;
    window.__images.remount();
  });
  await dialog
    .getByText("当前 Host 无法进行 GitHub 图片上传，请使用仓库网页", { exact: true })
    .waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "添加图片", exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "打开仓库网页", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__images.external),
    "https://github.com/synthetic/project",
  );
  await page.evaluate(() => {
    window.__images.supported = true;
    window.__images.requiresWebLogin = false;
    window.__images.remount();
  });
  await choose("api-upload.png");
  await dialog.getByText("正在上传图片…", { exact: true }).waitFor();
  assert.equal(await dialog.getByText(desktopUploadHint, { exact: true }).count(), 0);
  assert.equal(await webButton.count(), 0);
  await release();
  await dialog.getByText("图片已上传", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write(`Repository image E2E passed. Screenshots: ${artifacts}\n`);
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  process.stderr.write(`Repository image E2E diagnostics: ${artifacts}\n`);
  if (page)
    process.stderr.write(
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          calls: window.__images?.calls,
          pending: window.__images?.pending.length,
        })),
      ) + "\n",
    );
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(fixture, { force: true });
}
