// Real hook + synthetic Host; deliberately unresolved RPCs, no Agent or user data.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-latency-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(html, `<div id="root"></div><script type="module" src="./${name}.tsx"></script>`);
  await writeFile(
    moduleFile,
    `
    import React,{useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {acpSessionSchema} from '@zcode/shared';
    import {useAcpConversation} from '../../../ui/test/acpProjectionFixture.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    const workspacePath='/synthetic/latency';
    const sessions=new Map(['A','B'].map(id=>[id,acpSessionSchema.parse({
      id,workspacePath,agent:'codex',acpSessionId:'native-'+id,title:id,revision:1,
      status:'idle',entries:[],pendingPermission:null,error:null
    })]));
    const listeners=new Set(),calls=[],pending=new Map();
    let delayId='A', rejectId=null, rejectSubmit=false;
    const controls={calls,pending};window.__latency=controls;
    const service={
      list:async()=>[...sessions.values()].map(s=>structuredClone(s)),
      onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
      refresh:async({id})=>{
        calls.push(['refresh',id]);
        if(id===delayId) await new Promise(resolve=>pending.set(id,resolve));
        if(id===rejectId) throw new Error('synthetic restore failure');
        return structuredClone(sessions.get(id));
      },
      submitPrompt:async({id,commandId,text})=>{
        calls.push(['submit',id,commandId]);
        if(rejectSubmit) throw new Error('synthetic acceptance failure');
        const session=sessions.get(id);session.revision++;session.status='running';
        session.entries.push({id:'user:'+commandId,kind:'user',text});
        return structuredClone(session);
      },
      read:async({id})=>structuredClone(sessions.get(id)),
      create:async()=>{throw new Error('history must not create a draft')},
      remove:async()=>{},
    };
    controls.release=id=>{delayId=null;pending.get(id)?.();pending.delete(id)};
    controls.delay=id=>{delayId=id};
    controls.reject=id=>{rejectId=id};
    controls.rejectSubmit=value=>{rejectSubmit=value};
    controls.snapshot=(id,status)=>{
      const session=sessions.get(id);session.status=status;session.revision++;
      for(const listener of listeners)listener({kind:'updated',session:structuredClone(session)});
    };
    function Fixture(){
      const view=useAcpConversation(service as never,{workspacePath},'codex');
      useEffect(()=>view.selectById('codex','A'),[view.selectById]);
      controls.select=id=>view.selectById('codex',id);
      controls.send=text=>view.send({text,attachments:[],workspaceFiles:[]});
      return <div data-testid='state' data-id={view.selected?.id??''}
        data-ready={view.loaded&&view.ready&&!view.busy} data-error={view.error??''}
        data-status={view.selected?.status??''} data-sending={view.sending}/>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><Fixture/></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL || "http://localhost:5174"}/${name}.html`);
    await page
      .waitForFunction(() => window.__latency?.pending.has("A"))
      .catch((error) => {
        throw new Error(error.message + "; page errors=" + errors.join("; "));
      });
    await page.evaluate(() => window.__latency.select("B"));
    await page.waitForFunction(
      () => {
        const view = document.querySelector('[data-testid="state"]');
        return view?.dataset.id === "B" && view.dataset.ready === "true";
      },
      null,
      { timeout: 3000 },
    );
    assert.equal(
      await page.evaluate(() => window.__latency?.pending.has("A")),
      true,
      "B must become usable before A returns",
    );
    const before = await page.evaluate(
      () => window.__latency.calls.filter(([op]) => op === "refresh").length,
    );
    assert.equal(await page.evaluate(() => window.__latency.send("first")), "B");
    assert.equal(
      await page.evaluate(() => window.__latency.calls.filter(([op]) => op === "refresh").length),
      before,
      "idle send must not wait for an extra refresh",
    );
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.status === "running",
    );
    assert.equal(await page.evaluate(() => window.__latency.send("second")), "B");
    assert.equal(
      await page.evaluate(() => window.__latency.calls.filter(([op]) => op === "refresh").length),
      before,
    );
    await page.evaluate(() => window.__latency.release("A"));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.getByTestId("state").getAttribute("data-id"), "B");
    assert.equal(await page.getByTestId("state").getAttribute("data-error"), "");

    await page.evaluate(() => {
      window.__latency.rejectSubmit(true);
      window.__latency.snapshot("B", "idle");
    });
    const failed = await page.evaluate(async () => {
      try {
        await window.__latency.send("retry");
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.match(failed, /synthetic acceptance failure/);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.sending === "false",
    );
    const failedCommand = await page.evaluate(
      () => window.__latency.calls.filter(([op]) => op === "submit").at(-1)[2],
    );
    await page.evaluate(() => window.__latency.rejectSubmit(false));
    assert.equal(await page.evaluate(() => window.__latency.send("retry")), "B");
    assert.equal(
      await page.evaluate(() => window.__latency.calls.filter(([op]) => op === "submit").at(-1)[2]),
      failedCommand,
      "failed admission retry retains command identity",
    );

    // 旧会话迟到失败也不能污染当前会话或解除其独立的等待。
    await page.evaluate(() => {
      window.__latency.delay("A");
      window.__latency.reject("A");
      window.__latency.select("A");
    });
    await page.waitForFunction(() => window.__latency?.pending.has("A"));
    await page.evaluate(() => window.__latency.select("B"));
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.ready === "true",
    );
    await page.evaluate(() => window.__latency.release("A"));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.getByTestId("state").getAttribute("data-error"), "");
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: same-Agent pending restore isolation, direct idle/running admission, retries and stale failures (1280/375px).\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
