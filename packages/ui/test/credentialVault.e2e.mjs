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
    import '../../../ui/src/styles.css';
    const state:any={calls:[]};window.__credentialVault=state;
    const entries:any[]=[];const secrets=new Map<string,string>();
    const service:any={
      async listVaultEntries(){return entries.map(entry=>({...entry}))},
      async saveVaultEntry(input:any){
        state.calls.push({operation:'save',hasSecret:Boolean(input.secret)});
        let entry=entries.find(candidate=>candidate.id===input.id);
        if(!entry){entry={id:crypto.randomUUID(),createdAt:Date.now(),hasSecret:true};entries.push(entry)}
        Object.assign(entry,{name:input.name,kind:input.kind,environment:input.environment,host:input.host,port:input.port,username:input.username,workspaceIdentity:input.workspaceIdentity,updatedAt:Date.now()});
        if(input.secret)secrets.set(entry.id,input.secret);
        state.values=()=>({count:entries.length,hasActiveSecret:Boolean(secrets.get(entry.id)),entryName:entry.name,kind:entry.kind,environment:entry.environment});
        return {...entry};
      },
      async deleteVaultEntry(id:string){state.calls.push({operation:'delete'});entries.splice(entries.findIndex(entry=>entry.id===id),1);secrets.delete(id)},
      async load(){return null},async save(){},async delete(){},
    };
    function Fixture(){const [visible,setVisible]=useState(true);state.setVisible=setVisible;return <div className='min-h-screen bg-background p-6 text-foreground'><ServiceProvider services={{credentialService:service}}>{visible?<CredentialVaultSection/>:null}</ServiceProvider></div>}
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
  await page.getByText("还没有保存的凭证", { exact: true }).waitFor();
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
  await dialog.getByLabel("授权工作区标识（可选）").fill("workspace:test:qa");
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

  await page.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await confirm.waitFor({ state: "detached" });
  await page.getByText("还没有保存的凭证", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__credentialVault.values())).count, 0);

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
