import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
// 只替换 Electron 与无关命令的边界，不启动桌面应用、浏览器或 Host。
const electronUrl = moduleUrl(`
  export const opened = [];
  export const app = { name: 'CodeVori', isPackaged: true }, dialog = {}, session = {};
  export const Menu = {
    template: [],
    buildFromTemplate(template) { this.template = template; return template; },
    setApplicationMenu() {},
  };
  export class BrowserWindow {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
  }
  export const shell = { async openExternal(url) { opened.push(url); } };
`);
const unrelatedExports = [
  "readZCodeStdioTapDevState",
  "setZCodeStdioTapDevEnabled",
  "showAboutDialog",
  "checkForUpdateMenuClick",
  "exportLogs",
  "openResourceManager",
  "resolveCuaOsSupport",
  "syncWindowControlsOverlayForZoomLevel",
  "DEFAULT_DESKTOP_WINDOW_HEIGHT",
  "DEFAULT_DESKTOP_WINDOW_WIDTH",
  "clampDesktopZoomLevel",
  "resolveDesktopZoomFactorForLevel",
  "resolveDesktopZoomLevelFromFactor",
  "CHECK_FOR_UPDATE_MENU_ID",
  "setAutoUpdaterMenuLocale",
  "DESKTOP_ZOOM_MAX_LEVEL",
  "DESKTOP_ZOOM_MIN_LEVEL",
];
const menuBoundaryValues = {
  readZCodeStdioTapDevState: "() => ({ visible: false, enabled: false })",
  clampDesktopZoomLevel: "(value) => value",
  CHECK_FOR_UPDATE_MENU_ID: "'check-for-update'",
  setAutoUpdaterMenuLocale: "() => {}",
  DESKTOP_ZOOM_MAX_LEVEL: "3",
  DESKTOP_ZOOM_MIN_LEVEL: "-3",
};
const unrelatedUrl = moduleUrl(
  unrelatedExports
    .map(
      (name) =>
        `export const ${name} = ${menuBoundaryValues[name] ?? `() => { throw new Error('Unexpected unrelated command: ${name}'); }`};`,
    )
    .join("\n"),
);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: electronUrl, shortCircuit: true };
    if (
      (context.parentURL?.includes("/src/main/desktopCommandHandlers.ts") ||
        context.parentURL?.includes("/src/main/desktopApplicationMenu.ts")) &&
      specifier !== "./desktopCommandHandlers.js" &&
      (specifier.startsWith("./") || specifier === "@zcode/services/node")
    ) {
      return { url: unrelatedUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

try {
  const { executeDesktopCommand } = await import("../src/main/desktopCommandHandlers.ts");
  const { rebuildApplicationMenu, getDesktopMenuLabel } =
    await import("../src/main/desktopApplicationMenu.ts");
  const { DesktopCommandIds, desktopMenuMessageIds } = await import("@zcode/shared");
  const { opened, Menu } = await import("electron");
  for (const locale of ["zh-CN", "en-US"]) {
    await test(`native changelog click opens CodeVori repository without reading endpoint settings: ${locale}`, async () => {
      opened.length = 0;
      let dispatch;
      rebuildApplicationMenu({
        currentApplicationLocale: locale,
        executeDesktopCommand: (command) => {
          assert.equal(command, DesktopCommandIds.OpenChangelog);
          dispatch = executeDesktopCommand({
            command,
            currentApplicationLocale: locale,
            logger: { info() {}, warn() {}, error() {} },
            settingService: {
              get: async () => assert.fail("Changelog must not read endpoint settings"),
            },
            zcodeEndpointEnvBaseOrigin: "https://example.invalid/upstream",
          });
          return dispatch;
        },
      });
      const item = Menu.template
        .flatMap((menu) => menu.submenu ?? [])
        .find(
          (item) => item.label === getDesktopMenuLabel(locale, desktopMenuMessageIds.helpWhatsNew),
        );
      assert.ok(item, "Native menu must contain the localized changelog item");
      item.click();
      assert.ok(dispatch);
      await dispatch;
      assert.deepEqual(opened, ["https://github.com/caiqiqqq/CodeVori"]);
    });
    for (const externalForm of [false, true]) {
      await test(`problem report opens CodeVori Issues directly: ${locale}, legacy external=${externalForm}`, async () => {
        opened.length = 0;
        let configReads = 0;
        await executeDesktopCommand({
          command: DesktopCommandIds.OpenFeedback,
          currentApplicationLocale: locale,
          logger: { info() {}, warn() {}, error() {} },
          senderWindow: {
            id: 1,
            isDestroyed: () => false,
            webContents: {
              send() {
                assert.fail("Must not send feedback dialog IPC");
              },
            },
          },
          fetchHelpConfig: async () => {
            configReads++;
            return {
              feedback_use_external_form: externalForm,
              feedback_url: "https://example.invalid/feedback",
            };
          },
        });
        assert.deepEqual(opened, ["https://github.com/caiqiqqq/CodeVori/issues"]);
        assert.equal(configReads, 0);
      });
    }
  }
} finally {
  hooks.deregister();
}
