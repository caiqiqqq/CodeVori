import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { PRODUCT_NAME, PRODUCT_MARK_PATH } from "@zcode/shared/product-brand";

// iOS 由系统裁圆角；复用 PC 字形，去掉桌面透明留白，避免手机出现白框或双重圆角。
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="96 96 832 832">
      <title>${PRODUCT_NAME}</title>
      <defs><linearGradient id="tile" x2="0" y2="1"><stop stop-color="#151718"/><stop offset="1" stop-color="#050606"/></linearGradient></defs>
      <rect x="96" y="96" width="832" height="832" fill="url(#tile)"/>
      <g transform="translate(256 294) scale(2)"><path d="${PRODUCT_MARK_PATH}" fill="#ffffff"/></g>
    </svg>`);
  const pixels = await page.screenshot();
  const target = new URL("../assets/", import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL("icon.png", target), pixels);
  process.stdout.write(`Generated ${PRODUCT_NAME} mobile icon.\n`);
} finally {
  await browser.close();
}
