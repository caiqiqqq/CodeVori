// Real reasoning selector, synthetic config only; no Agent or model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__mobile-thought-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-mobile-thought-"));
let browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState,useRef,useLayoutEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ThoughtLevelCycleControl} from '../../../ui/src/chat-input-toolbar/ThoughtLevelCycleControl.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[]};window.__thought=state;state.theme=applyTheme;
    function Control(){const {intl}=useZCodeIntl();const [value,setValue]=useState('high');state.value=value;const ref=useRef(null);const host=useRef<HTMLDivElement>(null);
      useLayoutEffect(()=>{host.current?.querySelector('[data-composer-thought-control]')?.setAttribute('data-composer-compact','true')},[]);
      return <main className='h-dvh bg-background p-4 text-foreground'><div ref={host} className='@container/composer flex h-10 w-full max-w-md'>
      <ThoughtLevelCycleControl intl={intl} triggerRef={ref} composerCollapsePriority={3} restoreFocusSelector={null}
        option={{id:'reasoning',name:'Reasoning',type:'select',currentValue:value,options:[{value:'off',label:'Off'},{value:'low',label:'Low'},{value:'high',label:'High'}]}}
        onValueChange={next=>{state.calls.push(next);setValue(next)}}/>
      </div></main>;
    }
    function Fixture(){const [locale,setLocale]=useState('zh-CN');state.locale=setLocale;return <ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><Control/></TooltipProvider></ZCodeIntlProvider>}
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 812 }, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5189"}/${name}.html`);
  const trigger = page.locator("[data-composer-thought-control]");
  await trigger.waitFor();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__thought.locale(locale), locale);
    await trigger.waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__thought.theme(theme), theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        assert.equal(await page.locator("[data-thought-level-progress]").isVisible(), width >= 768);
        assert.ok(await trigger.getAttribute("aria-label"));
        assert.equal(await trigger.locator("svg.lucide-brain").isVisible(), true);
        const before = await page.evaluate(() => window.__thought.calls.length);
        await trigger.tap();
        await page.getByRole("listbox").waitFor();
        const next = await page.evaluate(() => (window.__thought.value === "low" ? "high" : "low"));
        await page
          .getByRole("option", {
            name:
              locale === "zh-CN" ? (next === "low" ? "低" : "高") : next === "low" ? "Low" : "High",
            exact: true,
          })
          .tap();
        await page.waitForFunction((next) => window.__thought.value === next, next);
        assert.equal(await page.evaluate(() => window.__thought.calls.length), before + 1);
        await page.screenshot({ path: join(artifacts, `${locale}-${theme}-${width}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: mobile icon-only reasoning control, desktop indicator, original selection and accessible labels, 320/390/1280, zh/en and light/dark. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
