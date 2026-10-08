// pnpm --filter @zcode/desktop exec node scripts/generate-product-icons.mjs
// 从共享 V 字形生成既有平台资源；不访问用户数据或第三方品牌图标。
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { Icns, IcnsImage } from "@fiahfy/icns";
import {
  PRODUCT_NAME,
  PRODUCT_MARK_PATH,
  PRODUCT_MARK_VIEW_BOX,
} from "@zcode/shared/product-brand";

const root = new URL("../../", import.meta.url);
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const mark = `<path d="${PRODUCT_MARK_PATH}" fill="currentColor"/>`;
const svg = (content, viewBox = "0 0 1024 1024") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>${PRODUCT_NAME}</title>${content}</svg>`;
const appContent = `<defs><linearGradient id="tile" x2="0" y2="1"><stop stop-color="#151718"/><stop offset="1" stop-color="#050606"/></linearGradient></defs>
  <rect x="96" y="96" width="832" height="832" rx="184" fill="url(#tile)" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
  <g transform="translate(256 294) scale(2)" color="#ffffff">${mark}</g>`;
const appSvg = svg(appContent);
const installerSvg =
  svg(`<defs><linearGradient id="box" x2="0" y2="1"><stop stop-color="#1d2021"/><stop offset="1" stop-color="#050606"/></linearGradient></defs>
  <path d="M160 116H864L928 280H96Z" fill="#191c1d" stroke="#343839" stroke-width="3"/>
  <path d="M96 280H928L894 924H130Z" fill="url(#box)" stroke="#343839" stroke-width="3"/>
  <path d="M160 116L512 196L864 116M512 196V280" fill="none" stroke="#343839" stroke-width="3"/>
  <g transform="translate(282 392) scale(1.8)" color="#ffffff">${mark}</g>`);

async function update(path, data) {
  const url = new URL(path, root);
  const previous = await readFile(url).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const next = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!previous?.equals(next)) await writeFile(url, next);
}

function ico(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([directory, ...images.map(({ png }) => png)]);
}

function icns(images) {
  const result = new Icns();
  for (const [type, size] of [
    ["ic11", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic14", 512],
    ["ic10", 1024],
  ])
    result.append(IcnsImage.fromPNG(images.get(size), type));
  return result.data;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  async function png(source, width, height = width) {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`,
    );
    return page.screenshot({ omitBackground: true });
  }
  const appImages = new Map();
  const installerImages = new Map();
  for (const size of sizes) {
    const image = await png(appSvg, size);
    appImages.set(size, image);
    installerImages.set(size, await png(installerSvg, size));
    await update(`desktop/build/icons/${size}x${size}.png`, image);
  }
  for (const file of ["icon.png", "icon_windows.png"])
    await update(`desktop/build/${file}`, appImages.get(1024));
  await update("desktop/build/icon.icns", icns(appImages));
  const appIco = ico(
    sizes.filter((size) => size <= 256).map((size) => ({ size, png: appImages.get(size) })),
  );
  await update("desktop/build/icon.ico", appIco);
  await update("web/public/favicon.ico", appIco);
  await update("desktop/build/icon_installer.png", installerImages.get(1024));
  await update("desktop/build/icon_installer.icns", icns(installerImages));
  await update(
    "desktop/build/icon_installer.ico",
    ico([{ size: 256, png: installerImages.get(256) }]),
  );
  await update("ui/src/assets/product-logo.svg", svg(appContent, "96 96 832 832"));
  // 保留装饰资源路径和渐隐风格，仅替换共享字形。
  await update(
    "ui/src/assets/Z.svg",
    svg(
      `<defs><linearGradient id="fade" x2="0" y2="1"><stop stop-color="#444444" stop-opacity=".6"/><stop offset=".5" stop-color="#2a2a2a" stop-opacity=".3"/><stop offset="1" stop-color="#1a1a1a" stop-opacity=".1"/></linearGradient></defs><g transform="translate(26 16.5) scale(1.5)"><path d="${PRODUCT_MARK_PATH}" fill="url(#fade)" fill-opacity=".15" stroke="url(#fade)"/></g>`,
      "0 0 436 360",
    ),
  );
  const background = svg(
    `<rect width="540" height="380" fill="#f4f5f6"/><g fill="none" stroke="#dadddf" stroke-width="4"><rect x="38" y="34" width="34" height="30" rx="6" transform="rotate(-18 55 49)"/><path d="M460 52l14 12-14 12M487 85h14M31 297l12 12-12 12M451 307h28v28h-28z"/><circle cx="98" cy="310" r="18"/><circle cx="450" cy="160" r="15"/></g><text x="270" y="117" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#303234">${PRODUCT_NAME}</text><path d="M220 212Q268 181 319 210M303 192L319 210L300 214" fill="none" stroke="#656869" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
    "0 0 540 380",
  );
  await update("desktop/build/dmg_background.png", await png(background, 540, 380));
  await update("desktop/build/dmg_background@2x.png", await png(background, 1080, 760));
  for (const path of ["desktop/src/renderer/index.html", "web/index.html"]) {
    let html = await readFile(new URL(path, root), "utf8");
    const animated = path.startsWith("web/");
    const animation = animated
      ? '<animate attributeName="opacity" dur="1.5s" repeatCount="indefinite" values="1;0.3;1"/>'
      : "";
    html = html.replace(
      /(<svg[^>]*class="(?:startup-logo|zcode-boot-loading__logo)"[^>]*>)[\s\S]*?<\/svg>/u,
      `$1<path fill="currentColor" d="${PRODUCT_MARK_PATH}">${animation}</path></svg>`,
    );
    if (!html.includes(PRODUCT_MARK_VIEW_BOX))
      throw new Error(`Unexpected startup viewBox: ${path}`);
    if (!html.includes(PRODUCT_MARK_PATH))
      throw new Error(`Startup logo was not replaced: ${path}`);
    if (animated)
      html = html.replace(
        /data:image\/png;base64,[A-Za-z0-9+/=]+/u,
        `data:image/png;base64,${appImages.get(32).toString("base64")}`,
      );
    await update(path, html);
  }
  process.stdout.write("Generated CodeVori V icons for desktop, installer, UI and Web.\n");
} finally {
  await browser.close();
}
