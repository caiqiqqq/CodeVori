import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__release-hover-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React from 'react';import {createRoot} from 'react-dom/client';import {UpdateReleaseNotesTooltip} from '../../../ui/src/UpdateReleaseNotesTooltip.tsx';
import '../../../ui/src/styles.css';
createRoot(document.getElementById('root')!).render(<div style={{padding:24}}><UpdateReleaseNotesTooltip locale="en-US" onOpenExternalUrl={()=>{}} releaseDateLabel="2026-10-23" releaseNotesTitle="3.16.3" releaseNotesMarkdown={Array.from({length:50},(_,i)=>'Paragraph '+i+' of complete release notes.').join('\\n\\n')}><button>Release notes</button></UpdateReleaseNotesTooltip></div>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    await page.getByRole("button", { name: "Release notes" }).hover();
    const tip = page.locator('[data-slot="tooltip-content"]');
    await tip.waitFor();
    await tip.hover();
    assert.equal(await tip.isVisible(), true);
    const scroll = tip.locator(".overflow-y-auto").first();
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    assert.ok((await scroll.evaluate((el) => el.scrollTop)) > 0);
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: release tooltip remains open while hovered, scrolls complete notes, closes with Escape, 1280/375px.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
