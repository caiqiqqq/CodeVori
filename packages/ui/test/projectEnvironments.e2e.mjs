// Synthetic Host only: exercises project environment UI without live credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__project-environments-e2e-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-project-environments-"));
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
    import {ProjectEnvironmentSection} from '../../../ui/src/settings/ProjectEnvironmentSection.tsx';
    import {ProjectEnvironmentSelector} from '../../../ui/src/v4/composer/ProjectEnvironmentSelector.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pendingReads:[],delayKey:null};window.__projectEnvironments=state;
    const profiles=new Map<string,any[]>(),bindings=new Map<string,any>(),listeners=new Map<string,Set<()=>void>>();
    const clone=(value:any)=>JSON.parse(JSON.stringify(value));
    const projectKey=(scope:any)=>scope.workspaceIdentity?.trim()||scope.workspacePath;
    const sessionKey=(scope:any)=>JSON.stringify([projectKey(scope),scope.kind,scope.sessionId]);
    const emit=(key:string)=>listeners.get(key)?.forEach(listener=>listener());
    const service:any={
      async listProjectEnvironments(scope:any){
        const key=projectKey(scope),snapshot=clone(profiles.get(key)||[]);
        if(state.delayKey===key)return new Promise(resolve=>state.pendingReads.push(()=>resolve(snapshot)));
        return snapshot;
      },
      async saveProjectEnvironment(input:any){
        const key=projectKey(input),items=profiles.get(key)||[],old=items.find(item=>item.id===input.id);
        if(old&&old.revision!==input.expectedRevision)throw new Error('environment.conflict');
        const profile={...input,id:old?.id||crypto.randomUUID(),revision:input.expectedRevision+1,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
        delete profile.expectedRevision;profiles.set(key,[...items.filter(item=>item.id!==profile.id),profile]);
        state.calls.push({operation:'save',key,input:clone(input)});emit(key);return clone(profile);
      },
      async deleteProjectEnvironment(input:any){
        const key=projectKey(input),items=profiles.get(key)||[];
        profiles.set(key,items.filter(item=>item.id!==input.id));state.calls.push({operation:'delete',key,id:input.id});emit(key);
      },
      async getSessionEnvironment(scope:any){
        const binding=bindings.get(sessionKey(scope))||{revision:0,environmentId:null,environmentRevision:null};
        const profile=(profiles.get(projectKey(scope))||[]).find(item=>item.id===binding.environmentId);
        return {...clone(binding),environment:profile&&profile.revision===binding.environmentRevision?clone(profile):null};
      },
      async setSessionEnvironment(input:any){
        const key=sessionKey(input),current=bindings.get(key)||{revision:0,environmentId:null,environmentRevision:null};
        if(current.revision!==input.expectedRevision)throw new Error('environment.conflict');
        const profile=(profiles.get(projectKey(input))||[]).find(item=>item.id===input.environmentId);
        const next={revision:current.revision+1,environmentId:input.environmentId,environmentRevision:profile?.revision??null};
        bindings.set(key,next);state.calls.push({operation:'select',key,environmentId:input.environmentId});emit(projectKey(input));
        return this.getSessionEnvironment(input);
      },
      onDynamicProjectEnvironmentsChanged(scope:any){
        const key=projectKey(scope);
        return (listener:()=>void)=>{const set=listeners.get(key)||new Set();set.add(listener);listeners.set(key,set);return {dispose(){set.delete(listener)}}};
      },
    };
    function Fixture(){
      const [workspace,setWorkspace]=useState({workspacePath:'/workspace-a',workspaceIdentity:'remote:A'});
      const [credentials,setCredentials]=useState([{id:'11111111-1111-4111-8111-111111111111',name:'QA Database',kind:'database',environment:'test',host:'db.qa.example.invalid',port:5432,username:'reader',workspaceIdentity:null,hasSecret:true,createdAt:1,updatedAt:1}]);
      state.setWorkspace=setWorkspace;state.setCredentials=setCredentials;state.emit=emit;state.releaseReads=()=>{state.delayKey=null;state.pendingReads.splice(0).forEach((release:()=>void)=>release())};
      return <div className='min-h-screen bg-background p-4 text-foreground'><ServiceProvider services={{credentialService:service}}><main className='mx-auto max-w-3xl space-y-6'><ProjectEnvironmentSection workspacePath={workspace.workspacePath} workspaceIdentity={workspace.workspaceIdentity} credentials={credentials}/><section className='flex flex-wrap gap-3 border-t border-border pt-4'><ProjectEnvironmentSelector {...workspace} sessionId='api-one' kind='api' busy={false}/><ProjectEnvironmentSelector {...workspace} sessionId='acp-one' kind='acp' busy={false}/></section></main></ServiceProvider></div>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );

  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 20_000 + (process.pid % 10_000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByRole("heading", { name: "项目环境档案" }).waitFor();
  await page.getByText("当前项目还没有环境档案", { exact: true }).waitFor();

  await page.getByRole("button", { name: "添加环境", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("环境名称").fill("Alpha QA");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByLabel("用途").fill("Read only QA database");
  await dialog.getByLabel("资源说明").fill("Synthetic database reference");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Alpha QA", { exact: true }).waitFor();

  const selectors = page.getByTestId("project-environment-selector");
  const apiSelector = selectors.nth(0);
  const acpSelector = selectors.nth(1);
  await apiSelector.getByRole("combobox").click();
  await page.getByRole("option", { name: /Alpha QA/ }).click();
  await page.getByRole("option", { name: /Alpha QA/ }).waitFor({ state: "detached" });
  assert.match(await apiSelector.innerText(), /Alpha QA/);
  assert.match(await acpSelector.innerText(), /不指定环境/);

  await page.evaluate(() => window.__projectEnvironments.setCredentials([]));
  await page.getByText("不可用：1", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑环境档案", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("关联的凭证当前不可用", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 320, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: join(artifacts, "unavailable-resource-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() =>
      window.__projectEnvironments.calls
        .filter((call) => call.operation === "save")
        .at(-1)
        .input.resources.map((resource) => resource.credentialId),
    ),
    ["11111111-1111-4111-8111-111111111111"],
  );

  await page.evaluate(() =>
    window.__projectEnvironments.setWorkspace({
      workspacePath: "/workspace-b",
      workspaceIdentity: "remote:B",
    }),
  );
  await page.getByText("当前项目还没有环境档案", { exact: true }).waitFor();
  await page.getByRole("button", { name: "添加环境", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("环境名称").fill("Beta Production");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Beta Production", { exact: true }).waitFor();

  await page.evaluate(() =>
    window.__projectEnvironments.setWorkspace({
      workspacePath: "/workspace-a",
      workspaceIdentity: "remote:A",
    }),
  );
  await page.getByText("Alpha QA", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__projectEnvironments.delayKey = "remote:A";
    window.__projectEnvironments.emit("remote:A");
  });
  await page.waitForFunction(() => window.__projectEnvironments.pendingReads.length >= 1);
  await page.evaluate(() =>
    window.__projectEnvironments.setWorkspace({
      workspacePath: "/workspace-b",
      workspaceIdentity: "remote:B",
    }),
  );
  await page.getByText("Beta Production", { exact: true }).waitFor();
  await page.evaluate(() => window.__projectEnvironments.releaseReads());
  await page.getByText("Beta Production", { exact: true }).waitFor();
  assert.equal(await page.getByText("Alpha QA", { exact: true }).count(), 0);

  await page.getByRole("button", { name: "删除环境", exact: true }).first().click();
  const confirmation = page.getByRole("dialog");
  await confirmation.getByRole("button", { name: "删除环境", exact: true }).click();
  await confirmation.waitFor({ state: "detached" });
  await page.getByText("当前项目还没有环境档案", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: project environment CRUD, credential references, API/ACP selection isolation, scope race, and 320px layout. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
