import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 只替换 Electron 窗口边界，验证实际 showAboutDialog 生成的标题和 HTML。
const electronUrl = `data:text/javascript,${encodeURIComponent(`
  export const app = { isPackaged: false, getVersion: () => "1.0.3" };
  export class BrowserWindow {
    static instances = [];
    constructor(options) { this.options = options; BrowserWindow.instances.push(this); }
    setMenuBarVisibility() {}
    once() {}
    async loadURL(url) { this.url = url; }
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "electron"
      ? { url: electronUrl, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});

try {
  const { showAboutDialog } = await import("../src/main/about.ts");
  const { BrowserWindow } = await import("electron");
  for (const [locale, title, copyright, versionLabel, button] of [
    ["zh-CN", "关于 CodeVori", "版权所有 ©", "版本", "确定"],
    ["en-US", "About CodeVori", "Copyright ©", "version", "OK"],
  ]) {
    await test(`About window uses CodeVori branding in ${locale}`, async () => {
      await showAboutDialog(undefined, locale);
      const window = BrowserWindow.instances.at(-1);
      assert.equal(window.options.title, title);
      const html = decodeURIComponent(window.url.split(",").slice(1).join(","));
      assert.ok(html.includes("<title>CodeVori</title>"));
      assert.ok(html.includes('aria-label="CodeVori About Window"'));
      assert.ok(/<h1[^>]*>\s*CodeVori<br\s*\/>/.test(html));
      assert.ok(html.includes(`${copyright} ${new Date().getFullYear()} CodeVori`));
      assert.ok(html.includes(`${versionLabel} 1.0.3`));
      assert.ok(html.includes(`>${button}</button>`));
      assert.ok(!html.includes("ZCode"));
    });
  }
} finally {
  hooks.deregister();
}
