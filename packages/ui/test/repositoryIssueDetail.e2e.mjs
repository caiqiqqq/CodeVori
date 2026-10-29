// Synthetic Hosts only. No real credentials, repositories or remote mutations.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { assertRepositoryImageAuthentication } from "./repositoryImageAuthAssertions.mjs";
import { assertRepositoryGithubImages } from "./repositoryGithubImageAssertions.mjs";

const { createGitlabForgeProvider } = await tsImport(
  "../../services/src/git/providers/gitlabForgeProvider.ts",
  import.meta.url,
);
// 使用真实 provider 输出进入 UI，覆盖内网 web_url 到平台外链的完整数据链。
const externalItem = await createGitlabForgeProvider(
  async () => ({
    data: {
      iid: 7,
      title: "Synthetic",
      web_url:
        "http://internal.example.invalid:1080/team/sub/project/-/work_items/7?view=full#note_7",
    },
    headers: new Headers(),
  }),
  "team/sub/project",
  "https://forge.example.invalid/git/team/sub/project",
).getItem({
  workspacePath: "/synthetic/A",
  repositoryKey: "A",
  accountId: "A",
  kind: "issue",
  number: 7,
});
const expectedExternalUrl =
  "https://forge.example.invalid/git/team/sub/project/-/work_items/7?view=full#note_7";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-issue-detail-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue-detail-"));
let browser;
let page;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepositoryPanel} from '../../../ui/src/repository-panel/RepositoryPanel.tsx';
    import {MessageResponse} from '../../../ui/src/components/ai-elements/message.tsx';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pendingExtras:[],pendingImages:[],pendingSignIns:[],authorizedHosts:[],needsSignIn:false,imageSignInError:'FORGE_MEDIA_AUTHENTICATION',failSignIn:null,delaySignIn:false,delayExtras:true,delayImage:false,failImage:true,failExtras:false};
    window.__detail=state;
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#16874b';ctx.fillRect(0,0,400,400);ctx.fillStyle='#db3142';ctx.fillRect(400,0,400,400);
    const dataBase64=canvas.toDataURL('image/png').split(',')[1];
    state.imageData=dataBase64;
    const preview={mediaType:'image/png',dataBase64,totalBytes:atob(dataBase64).length};
    const staleCanvas=document.createElement('canvas');staleCanvas.width=1;staleCanvas.height=1;const staleBase64=staleCanvas.toDataURL('image/png').split(',')[1];const stalePreview={...preview,dataBase64:staleBase64,totalBytes:atob(staleBase64).length};
    const project='https://forge.example.invalid/git/team/sub/project';
    const user={username:'tester',displayName:'测试用户',avatarUrl:null};
    const label={key:'bug',name:'bug',color:'#d73a4a'};
    const item=(host:string,r:any)=>({number:7,kind:'issue',title:host+' 网页式议题详情与完整图片',body:state.github?'<img width="800" height="400" alt="GitHub screenshot" src="https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc" />':'## 问题描述\\n\\n复现步骤和页面截图。\\n\\n![Synthetic screenshot](/uploads/0123456789abcdef0123456789abcdef/screenshot.png)\\n\\n[Related issue](8) [blocked file](file:///tmp/private.txt)\\n\\n- [x] 已确认\\n- [ ] 待修复',state:'open',draft:false,author:user,url:state.github?'https://github.com/team/project/issues/7':${JSON.stringify(externalItem.url)},createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z',labels:[{...label,color:null}],commentCount:1,change:null,metadata:{assignees:[user],milestone:{title:'下一版',url:project+'/-/milestones/1'},dueDate:'2026-10-20',timeStats:{estimateSeconds:3600,spentSeconds:1800},confidential:false,taskStatus:{total:2,completed:1}}});
    const extras={participants:[user],participantsHasMore:false,linkedItems:[{number:8,title:'关联的修复任务',state:'open',url:project+'/-/issues/8'}],linkedItemsHasMore:false,labels:[label]};
    const services:any={};
    for(const host of ['A','B']) services[host]={gitService:{
      async getForgeRepository(r:any){state.calls.push({host,op:'discover',...r});return {status:'ready',remoteNames:['origin'],remoteName:'origin',repository:{key:host,name:state.github?'team/project':'team/sub/project',provider:state.github?'github':'gitlab',url:state.github?'https://github.com/team/project':project,accountId:host,accountUsername:'tester'}}},
      async listForgeItems(r:any){state.calls.push({host,op:'list',...r});return {items:[item(host,r)],page:r.page,pageSize:20,hasMore:r.page===1,total:21,reachableTotal:21,incomplete:false}},
      async listForgeLabels(){return [label]},
      async getForgeItem(r:any){state.calls.push({host,op:'item',...r});return item(host,r)},
      async getForgeItemExtras(r:any){state.calls.push({host,op:'extras',...r});const result={...extras,participants:[{...user,displayName:host+' 参与者'}]};if(state.delayExtras){state.delayExtras=false;return new Promise(resolve=>state.pendingExtras.push(()=>resolve(result)))}return state.failExtras?{errors:{participants:'FORGE_FORBIDDEN',links:'FORGE_NOT_FOUND',labels:'FORGE_RESPONSE'}}:result},
      async listForgeComments(r:any){state.calls.push({host,op:'comments',...r});if(state.github)return {page:r.page,pageSize:30,hasMore:false,total:1,items:[{id:'github-comment',body:'![Comment screenshot](https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc)',author:user,createdAt:'2026-10-02T00:00:01Z',url:null}]};return {page:r.page,pageSize:30,hasMore:r.page===1,total:4,items:r.page===1?[{id:'label-event:1',body:'',author:user,createdAt:'2026-10-01T00:00:00Z',system:true,url:null,labelActivity:{action:'add',labels:[label,{key:'optimization',name:'优化',color:'#16874b'}]}},{id:'system',body:'assigned to tester',author:user,createdAt:'2026-10-01T00:00:01Z',system:true,url:null}]:[{id:'label-event:3',body:'',author:user,createdAt:'2026-10-02T00:00:00Z',system:true,url:null,labelActivity:{action:'remove',labels:[null]}},{id:'comment',body:'正常评论',author:user,createdAt:'2026-10-02T00:00:01Z',system:false,url:null}]}},
      async readForgeImage(r:any){state.calls.push({host,op:'image',...r});if(state.needsSignIn&&!state.authorizedHosts.includes(host))throw new Error(state.imageSignInError);if(state.delayImage){state.delayImage=false;return new Promise(resolve=>state.pendingImages.push(()=>resolve(state.github&&host==='A'?stalePreview:preview)))}if(state.failImage){state.failImage=false;throw new Error('FORGE_FORBIDDEN')}return preview},
      async authenticateForgeImage(r:any){state.calls.push({host,op:'authenticate',...r});if(state.failSignIn){const code=state.failSignIn;state.failSignIn=null;throw new Error(code)}if(state.delaySignIn){state.delaySignIn=false;return new Promise<void>(resolve=>state.pendingSignIns.push(()=>{state.authorizedHosts.push(host);resolve()}))}state.authorizedHosts.push(host)},
      async createForgeComment(r:any){state.calls.push({host,op:'write',...r})},
    }};
    const platform:any={openExternal:(url:string)=>state.calls.push({op:'external',url}),readFile:()=>{throw new Error('Local IO must not occur')}};
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    const chatMarkdown=['# Chat regression','[local.ts](file:///synthetic/local.ts)','![Chat image](https://images.example.invalid/chat.png)','| Key | Value |\\n| --- | --- |\\n| row | preserved |'].join('\\n\\n');
    function Fixture(){const [version,setVersion]=useState(0);const [host,setHost]=useState('A');state.showGithub=()=>{state.github=true;state.needsSignIn=false;state.failImage=true;setHost('B');setVersion(v=>v+1)};const [active,setActive]=useState(true);const [theme,setTheme]=useState<any>('zai-light');const [chat,setChat]=useState(false);state.switchHost=setHost;state.setActive=setActive;state.showChat=setChat;state.setTheme=(value:any)=>{applyTheme(value);setTheme(value)};
      return <ServiceProvider services={services[host]}>{chat?<div data-testid='chat-markdown-regression' className='p-4'><MessageResponse workspacePath='/synthetic' theme={theme} codePreviewSettings={DEFAULT_CODE_PREVIEW_SETTINGS} onOpenFileLink={(target:any)=>state.calls.push({op:'local-link',...target})}>{chatMarkdown}</MessageResponse></div>:<><div hidden={!active} className='h-dvh'><RepositoryPanel key={version} workspacePath={'/synthetic/'+host} active={active} theme={theme}/></div>{!active?<div data-testid='settings-cover'>设置</div>:null}</>}</ServiceProvider>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    timezoneId: "America/Los_Angeles",
  });
  await page.route("https://images.example.invalid/chat.png", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(await page.evaluate(() => window.__detail.imageData), "base64"),
    }),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("repository-panel");
  const row = () => panel.getByTestId("repository-item-row").first();
  const settleVisuals = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  await row().waitFor();
  await page.evaluate(() => window.__detail.setTheme("zai-light"));
  const search = panel.getByRole("textbox", { name: "搜索标题和描述" });
  await search.fill("retained filter");
  await search.press("Enter");
  await page.waitForFunction(() =>
    window.__detail.calls.some((c) => c.op === "list" && c.search === "retained filter"),
  );
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() =>
    window.__detail.calls.some((c) => c.op === "list" && c.page === 2),
  );
  await row().click();
  const detail = panel.getByTestId("repository-item-detail");
  await detail.getByRole("heading", { name: "问题描述", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Detail must be native main-view content",
  );
  await detail.getByTestId("repository-attributes").getByText("下一版", { exact: true }).waitFor();
  await detail
    .getByTestId("repository-attributes")
    .getByText(/10月20日/)
    .waitFor();
  assert.equal(await page.evaluate(() => window.__detail.pendingExtras.length), 1);
  await page.evaluate(() => window.__detail.pendingExtras.shift()());
  await detail
    .getByTestId("repository-participants")
    .getByText("A 参与者", { exact: true })
    .waitFor();
  await detail.getByText("关联的修复任务", { exact: true }).waitFor();
  await detail.getByText("1 / 2", { exact: true }).waitFor();
  await detail.getByTestId("repository-image").getByRole("alert").waitFor();
  await detail
    .getByTestId("repository-image")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  const image = detail.getByTestId("repository-inline-image");
  await image.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="repository-inline-image"]')?.naturalWidth === 800,
  );
  assert.deepEqual(
    await image.evaluate((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return [
        Array.from(ctx.getImageData(100, 100, 1, 1).data),
        Array.from(ctx.getImageData(600, 100, 1, 1).data),
      ];
    }),
    [
      [22, 135, 75, 255],
      [219, 49, 66, 255],
    ],
  );
  const bounds = await image.boundingBox();
  assert.ok(Math.abs(bounds.width / bounds.height - 2) < 0.02, "Image aspect ratio is preserved");
  const attributesBounds = await detail.getByTestId("repository-attributes").boundingBox();
  assert.ok(attributesBounds.x > bounds.x + bounds.width, "Attributes are to the right on desktop");
  const imageCalls = await page.evaluate(() =>
    window.__detail.calls.filter((c) => c.op === "image"),
  );
  assert.ok(
    imageCalls.every((c) =>
      c.url.startsWith("https://forge.example.invalid/git/team/sub/project/uploads/"),
    ),
  );
  await detail.getByRole("button", { name: "Related issue", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__detail.calls.find((c) => c.op === "external").url),
    "https://forge.example.invalid/git/team/sub/project/-/work_items/8",
  );
  assert.equal(await detail.locator('a[href^="file:"]').count(), 0);
  const assertIssueExternalLink = async () => {
    await detail
      .locator("header")
      .getByRole("button", { name: "在浏览器中打开", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => window.__detail.calls.filter((c) => c.op === "external").at(-1).url,
      ),
      expectedExternalUrl,
    );
  };
  await assertIssueExternalLink();
  assert.equal(await detail.locator("[data-markdown-local-path-trigger]").count(), 0);
  const draft = detail.getByRole("textbox", { name: "评论", exact: true });
  await draft.fill("保留评论草稿");
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "image").length),
    imageCalls.length,
    "Typing must not remount Markdown/images",
  );
  const labelActivity = detail.getByTestId("repository-label-activity");
  await labelActivity.getByText("bug", { exact: true }).waitFor();
  assert.equal(await labelActivity.count(), 1, "Two added labels are one activity row");
  assert.equal(await labelActivity.getByText("优化", { exact: true }).count(), 1);
  assert.match(await labelActivity.innerText(), /添加了标签/);
  assert.deepEqual(
    await labelActivity
      .locator("[style]")
      .evaluateAll((nodes) => nodes.map((node) => node.style.backgroundColor)),
    ["rgb(215, 58, 74)", "rgb(22, 135, 75)"],
  );
  assert.equal(await detail.getByTestId("repository-system-note").count(), 2);
  const commentsCalls = await page.evaluate(
    () => window.__detail.calls.filter((c) => c.op === "comments").length,
  );
  await detail.getByRole("combobox", { name: "活动筛选", exact: true }).click();
  await page.getByRole("option", { name: "仅评论", exact: true }).click();
  assert.equal(await detail.getByTestId("repository-system-note").count(), 0);
  assert.equal(await labelActivity.count(), 0);
  await detail.getByRole("button", { name: "加载更多", exact: true }).click();
  await detail.getByText("正常评论", { exact: true }).waitFor();
  await detail.getByRole("combobox", { name: "活动筛选", exact: true }).click();
  await page.getByRole("option", { name: "全部活动", exact: true }).click();
  await detail.getByTestId("repository-system-note").first().waitFor();
  assert.equal(await detail.getByTestId("repository-system-note").count(), 3);
  assert.equal(await labelActivity.count(), 2);
  assert.match(await labelActivity.last().innerText(), /移除了标签/);
  await labelActivity.last().getByText("已删除的标签", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "comments").length),
    commentsCalls + 1,
    "Activity filters do not refetch the timeline",
  );
  assert.equal(await draft.inputValue(), "保留评论草稿");
  await settleVisuals();
  await page.screenshot({ path: join(artifacts, "desktop-activity.png") });
  await detail.getByTestId("repository-detail-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  await settleVisuals();
  assert.ok(
    await page.evaluate(() => document.documentElement.classList.contains("theme-zai-light")),
  );
  await page.screenshot({ path: join(artifacts, "desktop-light.png") });
  await detail.getByRole("button", { name: "预览图片", exact: true }).click();
  await page.getByTestId("repository-image-preview").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("repository-image-preview").waitFor({ state: "detached" });
  await detail.getByRole("button", { name: "预览图片", exact: true }).click();
  await page.getByTestId("repository-image-preview").waitFor();
  await page.evaluate(() => window.__detail.setActive(false));
  await page.getByTestId("settings-cover").waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Covered image preview must not block settings",
  );
  await page.evaluate(() => window.__detail.setActive(true));
  await detail.waitFor();
  assert.equal(await draft.inputValue(), "保留评论草稿");
  if (await page.getByTestId("repository-image-preview").count())
    await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "write").length),
    0,
  );
  await page.evaluate(() => window.__detail.setTheme("zai-dark"));
  await detail.getByTestId("repository-detail-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  await settleVisuals();
  await page.screenshot({ path: join(artifacts, "desktop-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertIssueExternalLink();
  await detail.getByTestId("repository-detail-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  const mobileBounds = await image.boundingBox();
  assert.ok(Math.abs(mobileBounds.width / mobileBounds.height - 2) < 0.02);
  const mobileAttributes = await detail.getByTestId("repository-attributes").boundingBox();
  assert.ok(
    mobileAttributes.y > mobileBounds.y + mobileBounds.height,
    "Attributes stack on mobile",
  );
  assert.ok(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await settleVisuals();
  await page.screenshot({ path: join(artifacts, "mobile-dark.png") });
  await page.evaluate(() => window.__detail.setTheme("zai-light"));
  await settleVisuals();
  await page.screenshot({ path: join(artifacts, "mobile-light.png") });
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  assert.equal(await search.inputValue(), "retained filter");
  await panel.getByText("第 2 页", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.evaluate(() => {
    window.__detail.failExtras = true;
  });
  await row().click();
  await detail.getByRole("heading", { name: "问题描述", exact: true }).waitFor();
  await detail.getByTestId("repository-participants").getByRole("alert").waitFor();
  await detail.getByTestId("repository-links").getByRole("alert").waitFor();
  assert.ok(await detail.getByRole("textbox", { name: "评论", exact: true }).isEnabled());
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.evaluate(() => {
    window.__detail.failExtras = false;
    window.__detail.delayImage = true;
    window.__detail.delayExtras = true;
  });
  await row().click();
  await page.waitForFunction(() => window.__detail.pendingImages.length === 1);
  await page.waitForFunction(() => window.__detail.pendingExtras.length === 1);
  await page.evaluate(() => window.__detail.switchHost("B"));
  await row().waitFor();
  await page.evaluate(() => {
    window.__detail.pendingImages.shift()();
    window.__detail.pendingExtras.shift()();
  });
  assert.equal(await panel.getByTestId("repository-inline-image").count(), 0);
  await row().click();
  await detail.getByRole("heading", { name: "B 网页式议题详情与完整图片", exact: true }).waitFor();
  await image.waitFor();
  await detail
    .getByTestId("repository-participants")
    .getByText("B 参与者", { exact: true })
    .waitFor();
  assert.equal(await detail.getByText("A 参与者", { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "image").at(-1).host),
    "B",
  );

  await assertRepositoryImageAuthentication({ page, detail, image, draft, row });
  await assertRepositoryGithubImages({ page, panel, artifacts });
  await page.evaluate(() => window.__detail.showChat(true));
  const chat = page.getByTestId("chat-markdown-regression");
  await chat.getByRole("heading", { name: "Chat regression", exact: true }).waitFor();
  await chat.getByRole("button", { name: "local.ts", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__detail.calls.find((c) => c.op === "local-link").path),
    "/synthetic/local.ts",
  );
  await chat.locator("[data-markdown-image-trigger]").waitFor();
  assert.equal(
    await chat.locator("[data-markdown-image-trigger]").count(),
    1,
    "Chat retains thumbnail rendering rather than issue full-width images",
  );
  await chat.getByRole("cell", { name: "preserved", exact: true }).waitFor();
  assert.equal(await chat.getByTestId("repository-image").count(), 0);
  assert.deepEqual(errors, []);
  process.stdout.write(`Repository issue detail E2E passed. Screenshots: ${artifacts}\n`);
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  process.stderr.write(`Issue detail diagnostics: ${artifacts}\n`);
  if (page)
    process.stderr.write(
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          menus: document.querySelectorAll('[role="listbox"]').length,
          images: Array.from(document.querySelectorAll("img")).map((img) => ({
            src: img.src,
            naturalWidth: img.naturalWidth,
          })),
          calls: window.__detail.calls,
        })),
      ) + "\n",
    );
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
