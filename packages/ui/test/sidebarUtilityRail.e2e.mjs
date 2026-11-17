import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import {
  sidebarFixtureModules,
  writeSidebarUtilityFixture,
} from "./sidebarUtilityRail.fixture.mjs";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__sidebar-utility-rail-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = resolve(import.meta.dirname, "../../../.tmp/sidebar-utility-rail");
let server, browser, page;
const errors = [];
try {
  await mkdir(artifacts, { recursive: true });
  await writeSidebarUtilityFixture(html, moduleFile, name);
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    plugins: [
      {
        name: "sidebar-utility-fixture",
        enforce: "pre",
        load(id) {
          const entry = Object.entries(sidebarFixtureModules).find(([path]) =>
            id.split("?")[0].endsWith(`/packages/ui/src/${path}`),
          );
          return entry?.[1];
        },
      },
    ],
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 812 }, hasTouch: true });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByTestId("fixture-task-39").waitFor({ state: "attached" });
  const settings = () => page.getByRole("button", { name: /^(设置|Settings)$/ });
  const phone = () =>
    page.getByRole("button", { name: /^(移动端远程控制|Mobile remote control)$/ });
  const scroll = () => page.getByTestId("workspace-sidebar-task-scroll");
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__rail.locale(locale), locale);
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__rail.theme(theme), theme);
      for (const width of [1280, 320, 264]) {
        await page.setViewportSize({ width, height: 812 });
        await settings().waitFor();
        const rail = page.locator('[data-sidebar-utility-rail="true"]');
        assert.equal(await rail.count(), 1, "One left utility rail owns both buttons");
        assert.equal(await settings().count(), 1);
        assert.equal(await phone().count(), 1);
        const a = await phone().boundingBox(),
          b = await settings().boundingBox();
        const list = await scroll().boundingBox();
        assert.ok(Math.abs(a.x - b.x) < 1 && a.y + a.height <= b.y, "Phone above settings");
        assert.ok(b.x < 16 && b.y + b.height > 770, "Buttons stay at the bottom left");
        assert.ok(a.x + a.width <= list.x && b.x + b.width <= list.x, "No list overlap");
        for (const fraction of [0, 0.5, 1]) {
          await scroll().evaluate((el, f) => {
            el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
          }, fraction);
          const style = await scroll().evaluate((el) => {
            const s = getComputedStyle(el);
            return { mask: s.maskImage, webkit: s.webkitMaskImage, anchor: s.overflowAnchor };
          });
          assert.deepEqual(style, { mask: "none", webkit: "none", anchor: "none" });
        }
        await page.getByTestId("fixture-task-39").click();
        assert.equal(await page.evaluate(() => window.__rail.selected), 39);
        await phone().click();
        await page.getByRole("dialog").waitFor();
        assert.match(
          await page.getByRole("dialog").innerText(),
          /移动端远程控制|Mobile remote control/,
        );
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.evaluate(() => window.__rail.closeSettings());
        await page.waitForFunction(() => !window.__rail.settingsOpen);
        if (width === 1280) {
          await settings().click();
        } else {
          await settings().focus();
          await page.keyboard.press("Enter");
        }
        await page.waitForFunction(() => window.__rail.settingsOpen);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await settings().evaluate((el) => el.blur());
        await page.mouse.move(Math.min(width, 320) - 1, 20);
        await page.getByRole("tooltip").waitFor({ state: "hidden" });
        await page
          .locator("main")
          .screenshot({ path: join(artifacts, `${width}-${locale}-${theme}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 812 });
      await page.evaluate(() => window.__rail.desktop(false));
      await phone().waitFor({ state: "detached" });
      await page.evaluate(() => window.__rail.closeSettings());
      await page.waitForFunction(() => !window.__rail.settingsOpen);
      await settings().tap();
      await page.waitForFunction(() => window.__rail.settingsOpen);
      await settings().evaluate((el) => el.blur());
      await page.getByRole("tooltip").waitFor({ state: "hidden" });
      await page
        .locator("main")
        .screenshot({ path: join(artifacts, `web-${locale}-${theme}.png`) });
      await page.evaluate(() => window.__rail.desktop(true));
      await phone().waitFor();
    }
  }
  await page.evaluate(() =>
    window.__rail.tree({ id: 1, target: { workspacePath: "/fixture", workspaceName: "Fixture" } }),
  );
  await page.getByTestId("fixture-file-tree").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-sidebar-utility-rail="true"]').getBoundingClientRect().right <=
      0,
  );
  await page.getByRole("button", { name: "Close tree" }).click();
  await settings().waitFor();
  await page.evaluate(() => window.__rail.desktop(false));
  await phone().waitFor({ state: "detached" });
  assert.equal(await phone().count(), 0, "Web does not offer desktop remote control");
  await page.evaluate(() => window.__rail.closeSettings());
  await page.waitForFunction(() => !window.__rail.settingsOpen);
  await settings().tap();
  await page.waitForFunction(() => window.__rail.settingsOpen);
  await page.evaluate(() => {
    window.__rail.footer(true);
    window.__rail.desktop(true);
  });
  await phone().waitFor();
  const a = await phone().boundingBox(),
    b = await settings().boundingBox();
  assert.ok(Math.abs(a.y - b.y) < 1 && a.x + a.width <= b.x, "Default footer remains horizontal");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: utility placement, scrolling, remote dialog, keyboard/touch settings, file tree, default footer; zh/en, light/dark, desktop/narrow Web. Screenshots: ${artifacts}\n`,
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
