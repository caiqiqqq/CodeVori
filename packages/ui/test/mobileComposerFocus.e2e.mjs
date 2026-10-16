// Real Lexical editor and application CSS; synthetic services, no live session.
// Desktop browser emulation verifies the iOS focus-zoom font floor, not a native keyboard.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__mobile-composer-focus-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-composer-focus-"));
let server, browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {LexicalChatInput} from '../../../ui/src/LexicalChatInput.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import {applyUiFontSizePx} from '../../../ui/src/lib/uiFontSize.ts';
    import '../../../ui/src/styles.css';
    const state:any={text:'',setTheme:applyTheme,setFontSize:applyUiFontSizePx};window.__focus=state;
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({})},broadcastService:broadcast};
    createRoot(document.getElementById('root')!).render(
      <PlatformProvider platform={{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider>
        <main className='flex min-h-dvh flex-col bg-background p-4 text-foreground'>
          <header>Conversation</header><div className='flex-1'/>
          <section className='relative rounded-lg border border-border p-3'>
            <LexicalChatInput workspacePath='/synthetic' taskId={null} placeholder='输入消息' inputTestId='composer' enableMentionPanel={false} enableSlashCommands={false} onChange={text=>state.text=text} onSubmit={()=>false}/>
          </section><button data-testid='blur'>收起键盘</button>
        </main>
      </TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
    );`,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const touch of [true, false]) {
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: touch });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
    const editor = page.getByTestId("composer");
    await editor.waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__focus.setTheme(theme), theme);
      for (const [width, height] of touch
        ? [
            [320, 700],
            [390, 844],
            [844, 390],
          ]
        : [
            [390, 844],
            [1280, 900],
          ]) {
        await page.setViewportSize({ width, height });
        for (const size of [12, 14, 18]) {
          await page.evaluate((size) => window.__focus.setFontSize(size), size);
          const expected = touch || width < 768 ? 16 : size;
          const font = () => editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
          await editor.focus();
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.press("Backspace");
          await page.waitForFunction(() => window.__focus.text === "");
          assert.equal(
            await font(),
            expected,
            `font floor: touch=${touch} width=${width} size=${size}`,
          );
          const placeholder = page.getByText("输入消息", { exact: true });
          assert.equal(
            await placeholder.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
            expected,
          );
          if (touch) await editor.tap();
          else await editor.click();
          await page.keyboard.insertText("键盘测试 draft");
          await page.waitForFunction(() => window.__focus.text === "键盘测试 draft");
          await page.getByTestId("blur").click();
          assert.equal(await editor.evaluate((el) => el === document.activeElement), false);
          assert.equal(await font(), expected);
          await editor.focus();
          assert.equal(await editor.innerText(), "键盘测试 draft");
          assert.equal(await font(), expected);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        await page.screenshot({
          path: join(artifacts, `${touch ? "touch" : "mouse"}-${theme}-${width}.png`),
        });
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real composer focus/type/blur/refocus, mobile portrait/landscape 16px floor, placeholder alignment, desktop font settings, no overflow; light/dark. Native iOS keyboard still requires device QA. Screenshots: ${artifacts}\n`,
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
