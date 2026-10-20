// Real scene container and chips, synthetic Client Scenes only; no Agent or user session.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__mobile-draft-suggestions-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-mobile-suggestions-"));
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
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConversationDraftSuggestedPromptsContainer} from '../../../ui/src/v4/ConversationDraftSuggestedPromptsContainer.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const labels=[['周报总结','Weekly summary'],['报错修复','Fix errors'],['PPT 制作','Create a presentation'],['代码审查','Review code'],['项目说明','Explain this project and its complete development workflow']];
    const state:any={reads:0};window.__suggestions=state;state.setTheme=applyTheme;
    state.draft=()=>useZCodeSessionStore.getState().getWorkspaceState('/synthetic').composerTextInsertRequest;
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({})},broadcastService:broadcast,
      clientScenesService:{list:async()=>{state.reads++;return {code:0,data:[{scene:'draft-suggestion',options:{prompts:{items:labels.map(([cn,en],index)=>({id:'scene-'+index,img:'SquareCode',labels:{cn,en},contents:{cn:'合成提示 '+index,en:'Synthetic prompt '+index}}))}}}]}}},
    };
    function Fixture(){const [locale,setLocale]=useState('zh-CN');state.setLocale=setLocale;return <PlatformProvider platform={{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><main className='min-h-dvh bg-background p-4 text-foreground'><div className='mx-auto max-w-4xl'><div className='h-32 rounded-2xl border border-border bg-card p-4'>Composer</div><ConversationDraftSuggestedPromptsContainer className='mt-6' workspacePath='/synthetic'/><div data-testid='after-suggestions' className='mt-4'>After suggestions</div></div></main></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>}
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
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
  page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const buttons = page.locator("[data-draft-suggested-prompt]");
  await buttons.nth(4).waitFor();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__suggestions.setLocale(locale), locale);
    await page
      .getByRole("button", {
        name: locale === "zh-CN" ? "周报总结" : "Weekly summary",
        exact: true,
      })
      .waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__suggestions.setTheme(theme), theme);
      for (const width of [320, 375, 390, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        const geometry = await page.evaluate(() => {
          const root = document.querySelector("[data-v4-draft-suggested-prompts]");
          const slot = document.querySelector("[data-v4-draft-suggested-prompts-slot]");
          const after = document.querySelector('[data-testid="after-suggestions"]');
          return {
            scrollWidth: root.scrollWidth,
            width: root.clientWidth,
            slot: slot.getBoundingClientRect().toJSON(),
            after: after.getBoundingClientRect().toJSON(),
            buttons: [...root.querySelectorAll("button")].map((b) =>
              b.getBoundingClientRect().toJSON(),
            ),
            pageWidth: document.documentElement.scrollWidth,
          };
        });
        assert.equal(geometry.buttons.length, 5);
        assert.ok(geometry.pageWidth <= width, "Scene chips must not widen the page");
        if (width < 768) {
          assert.ok(
            geometry.scrollWidth <= geometry.width,
            "All mobile scenes must fit without horizontal scrolling",
          );
          for (const box of geometry.buttons) {
            assert.ok(
              box.x >= geometry.slot.x && box.right <= geometry.slot.right,
              "Each mobile scene is directly visible",
            );
            assert.ok(box.bottom <= geometry.slot.bottom, "Slot must contain every wrapped row");
            assert.ok(
              box.bottom <= geometry.after.y,
              "Wrapped scenes must not overlap following content",
            );
          }
          assert.ok(geometry.buttons[4].y > geometry.buttons[0].y, "Five scenes wrap on mobile");
          for (const index of [3, 4]) {
            await buttons.nth(index).tap();
            await page.waitForFunction(
              ({ index, locale }) =>
                window.__suggestions.draft()?.text ===
                (locale === "zh-CN" ? "合成提示 " : "Synthetic prompt ") + index,
              { index, locale },
            );
          }
        } else {
          assert.ok(
            geometry.buttons.every((box) => box.y === geometry.buttons[0].y),
            "Desktop retains one row",
          );
          const row = page.locator("[data-v4-draft-suggested-prompts]");
          await row.evaluate((el) => (el.scrollLeft = el.scrollWidth));
          await buttons.nth(4).click();
          await page.waitForFunction(
            (locale) =>
              window.__suggestions.draft()?.text ===
              (locale === "zh-CN" ? "合成提示 4" : "Synthetic prompt 4"),
            locale,
          );
          await row.evaluate((el) => (el.scrollLeft = 0));
        }
        await page.screenshot({
          path: join(artifacts, `${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: five scenes visible and last two tappable at 320/375/390px, growing slot without overlap, desktop single-row scrolling, zh/en and light/dark. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: join(artifacts, "failure.png"), animations: "disabled" })
    .catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
