// Synthetic Host only: uses fake values and never reads the user's credential store.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__credential-vault-e2e-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "codevori-credential-vault-ui-"));
let server;
let browser;
let page;
const errors = [];

try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {CredentialVaultSection} from '../../../ui/src/settings/CredentialVaultSection.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pendingReads:[],delayScope:null,setTheme:applyTheme};window.__credentialVault=state;
    const entries:any[]=[];const secrets=new Map<string,string>();
    const gitService:any={async getWorkspaceRepositoryInfo({workspacePath}:any){return {workspacePath,isGitAvailable:true,repoRoot:workspacePath,kind:workspacePath.startsWith('/worktrees/')?'linked-worktree':'main-tree',...(workspacePath.startsWith('/worktrees/')?{mainWorktreePath:'/projects/sample',branchName:workspacePath.includes('/one/')?'feature/one':'feature/two'}:{})}}};
    const service:any={
      async listVaultEntries(workspaceIdentity:string){const snapshot=entries.filter(entry=>entry.scope==='project'&&entry.projectIdentities?.includes(workspaceIdentity)).map(entry=>({...entry,workspaceIdentity}));if(state.delayScope===workspaceIdentity)return new Promise(resolve=>state.pendingReads.push(()=>resolve(snapshot)));return snapshot},
      async listGlobalVaultEntries(){return entries.filter(entry=>entry.scope==='global').map(entry=>({...entry}))},
      async listUnassignedVaultEntries(){return entries.filter(entry=>entry.scope==='unassigned').map(entry=>({...entry}))},
      async listAttachableVaultEntries(workspaceIdentity:string){return entries.filter(entry=>['unassigned','project'].includes(entry.scope)&&!entry.projectIdentities?.includes(workspaceIdentity)).map(entry=>({...entry,workspaceIdentity:null}))},
      async saveVaultEntry(input:any){
        state.calls.push({operation:'save',hasSecret:Boolean(input.secret),scope:input.scope,workspaceIdentity:input.workspaceIdentity});
        let entry=entries.find(candidate=>candidate.id===input.id);
        if(!entry){entry={id:crypto.randomUUID(),createdAt:Date.now(),hasSecret:true};entries.push(entry)}
        Object.assign(entry,{name:input.name,kind:input.kind,environment:input.environment,host:input.host,port:input.port,username:input.username,scope:input.scope,workspaceIdentity:input.workspaceIdentity,updatedAt:Date.now()});
        if(input.secret)secrets.set(entry.id,input.secret);
        state.values=()=>({count:entries.length,hasActiveSecret:Boolean(secrets.get(entry.id)),entryName:entry.name,kind:entry.kind,environment:entry.environment});
        return {...entry};
      },
      async attachVaultEntry(id:string,workspaceIdentity:string){state.calls.push({operation:'attach',workspaceIdentity});const entry=entries.find(candidate=>candidate.id===id&&['unassigned','project'].includes(candidate.scope));if(!entry)throw new Error('already attached');entry.scope='project';entry.projectIdentities??=[];entry.projectIdentities.push(workspaceIdentity);entry.workspaceIdentity=null},
      async attachVaultEntryGlobally(id:string){state.calls.push({operation:'attach-global'});const entry=entries.find(candidate=>candidate.id===id&&candidate.scope==='unassigned');if(!entry)throw new Error('already attached');entry.scope='global'},
      async detachVaultEntry(id:string,workspaceIdentity:string){state.calls.push({operation:'detach',workspaceIdentity});const entry=entries.find(candidate=>candidate.id===id&&candidate.scope==='project'&&candidate.projectIdentities?.includes(workspaceIdentity));if(!entry)throw new Error('not found');entry.projectIdentities=entry.projectIdentities.filter((identity:string)=>identity!==workspaceIdentity);if(entry.projectIdentities.length===0)entry.scope='unassigned'},
      async detachGlobalVaultEntry(id:string){state.calls.push({operation:'detach-global'});const entry=entries.find(candidate=>candidate.id===id&&candidate.scope==='global');if(!entry)throw new Error('not found');entry.scope='unassigned'},
      async deleteVaultEntry(id:string,scope:string,workspaceIdentity:string|null){state.calls.push({operation:'delete',scope,workspaceIdentity});const index=entries.findIndex(entry=>entry.id===id&&entry.scope===scope&&entry.workspaceIdentity===workspaceIdentity);if(index>=0)entries.splice(index,1);secrets.delete(id)},
      async load(){return null},async save(){},async delete(){},
    };
    state.seedLayout=()=>{entries.push(...['project','global','unassigned'].map((scope,index)=>({id:'layout-'+index,name:['项目数据库','共享服务器','待关联数据库'][index],kind:index===1?'server':'database',environment:index===1?'production':'test',host:'service.example.invalid',port:index===1?22:5432,username:'demo_reader',scope,workspaceIdentity:null,projectIdentities:scope==='project'?['remote:project-a']:[],hasSecret:true,createdAt:0,updatedAt:0})))};
    function Fixture(){const [visible,setVisible]=useState(true);state.setVisible=setVisible;state.releaseReads=()=>state.pendingReads.splice(0).forEach((release:()=>void)=>release());const projects=[{workspacePath:'/projects/sample',label:'示例仓库'},{workspacePath:'/worktrees/one/sample',label:'示例仓库'},{workspacePath:'/worktrees/two/sample',label:'示例仓库'},{workspacePath:'/project-a',workspaceIdentity:'remote:project-a',label:'项目 A'},{workspacePath:'/project-a',workspaceIdentity:'remote:project-a',label:'项目 A'},{workspacePath:'/project-b',workspaceIdentity:'remote:project-b',label:'项目 B'},...Array.from({length:12},(_,index)=>({workspacePath:'/projects/'+('long-project-path/').repeat(8)+index,label:'示例项目 '+(index+1)}))];return <div className='min-h-screen bg-background px-4 py-8 text-foreground'><div className='mx-auto max-w-4xl lg:px-8'><h1 className='mb-8 text-ui-xl font-semibold'>凭证</h1><ServiceProvider services={{credentialService:service,gitService}}>{visible?<CredentialVaultSection initialWorkspacePath='/project-a' initialWorkspaceIdentity='remote:project-a' projects={projects}/>:null}</ServiceProvider></div></div>}
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );

  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19_500 + (process.pid % 10_000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByRole("button", { name: /项目 A/ }).waitFor();
  await page.getByRole("button", { name: /项目 B/ }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /项目 A/ }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: /feature\/one/ }).waitFor();
  const projectNavigation = page.getByRole("navigation", { name: "项目", exact: true });
  assert.equal(await projectNavigation.getByText("示例仓库", { exact: true }).count(), 1);
  assert.equal(await projectNavigation.getByText("项目 A", { exact: true }).count(), 1);
  assert.equal(await projectNavigation.locator("ul ul button").count(), 2);
  await page.getByText("该项目还没有关联凭证。", { exact: true }).waitFor();
  await page
    .getByText("全局凭证", { exact: true })
    .count()
    .then((count) => assert.equal(count, 0));
  await page.screenshot({
    path: join(artifacts, "credential-vault-empty.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "添加凭证", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByLabel("名称").fill("QA 数据库");
  await dialog.getByLabel("类型").click();
  await page.getByRole("option", { name: "数据库", exact: true }).click();
  await dialog.getByLabel("环境").click();
  await page.getByRole("option", { name: "预发布", exact: true }).click();
  await dialog.getByLabel("主机").fill("db.qa.example.invalid");
  await dialog.getByLabel("端口").fill("5432");
  await dialog.getByLabel("用户名").fill("qa_reader");
  await dialog.getByLabel("密码或令牌").fill("synthetic-initial-secret");
  await page.screenshot({
    path: join(artifacts, "credential-vault-form.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__credentialVault.values()), {
    count: 1,
    hasActiveSecret: true,
    entryName: "QA 数据库",
    kind: "database",
    environment: "staging",
  });
  assert.doesNotMatch(await page.locator("body").innerText(), /synthetic-initial-secret/);
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).workspaceIdentity,
    null,
  );
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).scope,
    "unassigned",
  );
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.screenshot({
    path: join(artifacts, "credential-vault-unassigned.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关联到所选项目", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).operation,
    "attach",
  );
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).workspaceIdentity,
    "remote:project-a",
  );
  await page.getByRole("button", { name: /feature\/one/ }).click();
  await page.getByRole("button", { name: "关联到所选项目", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).workspaceIdentity,
    "/worktrees/one/sample",
  );
  await page.getByRole("button", { name: /示例仓库/ }).click();
  await page.getByText("该项目还没有关联凭证。", { exact: true }).waitFor();
  await page.getByRole("button", { name: /feature\/two/ }).click();
  await page.getByText("该项目还没有关联凭证。", { exact: true }).waitFor();
  await page.getByRole("button", { name: /feature\/one/ }).click();
  await page.getByRole("button", { name: "从所选项目移除", exact: true }).click();
  await page.getByRole("button", { name: /项目 B/ }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "关联到所选项目", exact: true }).count(), 1);
  await page.getByRole("button", { name: "关联到所选项目", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).workspaceIdentity,
    "remote:project-b",
  );
  await page.getByRole("button", { name: /项目 A/ }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const staleEditDialog = page.getByRole("dialog");
  await staleEditDialog.getByRole("button", { name: "取消", exact: true }).click();
  await staleEditDialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /项目 B/ }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "从所选项目移除", exact: true }).count(), 1);
  await page.evaluate(() => {
    window.__credentialVault.delayScope = "remote:project-a";
  });
  await page.getByRole("button", { name: /项目 A/ }).click();
  await page.waitForFunction(() => window.__credentialVault.pendingReads.length === 1);
  await page.getByRole("button", { name: /项目 B/ }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.evaluate(() => window.__credentialVault.releaseReads());
  assert.equal(await page.getByText("QA 数据库", { exact: true }).count(), 1);
  await page.evaluate(() => {
    window.__credentialVault.delayScope = null;
  });
  await page.getByRole("button", { name: /项目 A/ }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.screenshot({
    path: join(artifacts, "credential-vault-list.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editDialog = page.getByRole("dialog");
  assert.equal(await editDialog.getByLabel("密码或令牌").inputValue(), "");
  await editDialog.getByLabel("主机").fill("db.qa-updated.example.invalid");
  await editDialog.getByRole("button", { name: "保存", exact: true }).click();
  await editDialog.waitFor({ state: "detached" });
  await page.getByText("db.qa-updated.example.invalid:5432", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__credentialVault.calls)).at(-1).hasSecret, false);

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("dialog").getByLabel("密码或令牌").fill("synthetic-rotated-secret");
  const rotateDialog = page.getByRole("dialog");
  await rotateDialog.getByRole("button", { name: "保存", exact: true }).click();
  await rotateDialog.waitFor({ state: "detached" });
  assert.equal((await page.evaluate(() => window.__credentialVault.calls)).at(-1).hasSecret, true);
  assert.doesNotMatch(await page.locator("body").innerText(), /synthetic-rotated-secret/);

  await page.setViewportSize({ width: 320, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "credential-vault-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("button", { name: "从所选项目移除", exact: true }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).operation,
    "detach",
  );
  await page.getByRole("button", { name: /项目 B/ }).click();
  await page.getByRole("button", { name: "从所选项目移除", exact: true }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: "全局", exact: true }).click();
  await page.getByRole("button", { name: "设为全局", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).operation,
    "attach-global",
  );
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: /项目 B/ }).click();
  assert.equal(await page.getByText("QA 数据库", { exact: true }).count(), 0);
  await page.screenshot({
    path: join(artifacts, "credential-vault-global-inherited.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "删除", exact: true }).count(), 0);
  await page.getByRole("button", { name: "全局", exact: true }).click();
  await page.getByRole("button", { name: "取消全局并移回未分配", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__credentialVault.calls)).at(-1).operation,
    "detach-global",
  );
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: /项目 B/ }).click();
  await page.getByRole("button", { name: "关联到所选项目", exact: true }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: "从所选项目移除", exact: true }).click();
  await page.getByText("QA 数据库", { exact: true }).waitFor();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await confirm.waitFor({ state: "detached" });
  await page.getByText("该项目还没有关联凭证。", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__credentialVault.values())).count, 0);

  await page.evaluate(() => window.__credentialVault.seedLayout());
  await page.getByRole("button", { name: /项目 A/ }).click();
  await page.getByText("项目数据库", { exact: true }).waitFor();
  assert.equal(await page.getByText("共享服务器", { exact: true }).count(), 0);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => window.__credentialVault.setTheme(theme), theme);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${theme}/${width}: no horizontal overflow`,
      );
      const nav = page.getByRole("navigation", { name: "项目", exact: true });
      const navBox = await nav.boundingBox();
      assert.ok(navBox.height < 720, `${theme}/${width}: long project list stays bounded`);
      for (const button of await page.locator("li button").all()) {
        const box = await button.boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= width,
          `${theme}/${width}: row actions stay on screen`,
        );
      }
      await page.screenshot({
        path: join(artifacts, `credential-vault-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }

  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: credential vault CRUD, secret redaction, password retention/rotation, 320px layout. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
