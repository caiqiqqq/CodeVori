import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const electronUrl = moduleUrl(`
  export const app = { name: 'CodeVori', isPackaged: true };
  export class BrowserWindow {}
  export const Menu = {
    template: [],
    buildFromTemplate(template) { return template; },
    setApplicationMenu(template) { this.template = template; },
    getApplicationMenu() { return { getMenuItemById() { return null; } }; },
  };
  export class Tray {
    setToolTip() {}
    setContextMenu(template) { this.template = template; }
    on() {}
  }
`);
const boundaryUrl = moduleUrl(`
  export const readZCodeStdioTapDevState = () => ({ visible: false, enabled: false });
  export const CHECK_FOR_UPDATE_MENU_ID = 'check-for-update';
  export const setAutoUpdaterMenuLocale = () => {};
  export const DESKTOP_ZOOM_MAX_LEVEL = 3, DESKTOP_ZOOM_MIN_LEVEL = -3;
  export const clampDesktopZoomLevel = (value) => value;
  export const HELP_TOGGLE_ZCODE_STDIO_TAP_MENU_ID = 'stdio-tap';
  export const HELP_TOGGLE_DEV_TOOLS_MENU_ID = 'devtools';
`);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: electronUrl, shortCircuit: true };
    if (
      context.parentURL?.endsWith("/src/main/desktopApplicationMenu.ts") &&
      (specifier.startsWith("./") || specifier === "@zcode/services/node")
    ) {
      return { url: boundaryUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
function onPlatform(platform, run) {
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
}

try {
  const { rebuildApplicationMenu, getDesktopMenuLabel } =
    await import("../src/main/desktopApplicationMenu.ts");
  const { createWindowsDesktopTray, updateWindowsDesktopTrayMenu } =
    await import("../src/main/desktopTray.ts");
  const { DesktopCommandIds, desktopMenuMessageIds } = await import("@zcode/shared");
  const { app, Menu } = await import("electron");
  for (const locale of ["zh-CN", "en-US"]) {
    const label = (id) => getDesktopMenuLabel(locale, id);
    for (const platform of ["darwin", "win32", "linux"]) {
      for (const packaged of [true, false]) {
        await test(`help hides data clearing and retains adjacent commands: ${platform}, ${locale}, packaged=${packaged}`, () => {
          app.isPackaged = packaged;
          const commands = [];
          onPlatform(platform, () =>
            rebuildApplicationMenu({
              currentApplicationLocale: locale,
              executeDesktopCommand: async (command) => commands.push(command),
            }),
          );
          const items = Menu.template.find(
            (menu) => menu.label === label(desktopMenuMessageIds.help),
          )?.submenu;
          assert.ok(items, "Help menu exists");
          assert.ok(
            !items.some((item) => item.label === label(desktopMenuMessageIds.helpClearAllData)),
          );
          assert.notEqual(items.at(-1).type, "separator");
          items.find((item) => item.label === label(desktopMenuMessageIds.helpExportLogs)).click();
          items.find((item) => item.label === label(desktopMenuMessageIds.helpFeedback)).click();
          assert.deepEqual(commands, [
            DesktopCommandIds.ExportLogs,
            DesktopCommandIds.OpenFeedback,
          ]);
        });
      }
    }
  }
  await test("Windows tray hides data clearing after creation and locale rebuild", () => {
    app.isPackaged = false;
    let locale = "zh-CN";
    const tray = onPlatform("win32", () =>
      createWindowsDesktopTray({
        getLocale: () => locale,
        showCurrentWindow() {},
        executeDesktopCommand: async () => assert.fail("No destructive command should run"),
        quitApp() {},
        logger: { warn: () => assert.fail("Tray construction should succeed") },
      }),
    );
    assert.ok(tray);
    for (locale of ["zh-CN", "en-US"]) {
      updateWindowsDesktopTrayMenu();
      const labels = tray.template.map((item) => item.label);
      const label = (id) => getDesktopMenuLabel(locale, id);
      assert.ok(!labels.includes(label(desktopMenuMessageIds.helpClearAllData)));
      for (const id of [
        desktopMenuMessageIds.helpAbout,
        desktopMenuMessageIds.trayOpenZCode,
        desktopMenuMessageIds.trayQuit,
      ]) {
        assert.ok(labels.includes(label(id)));
      }
    }
  });
} finally {
  hooks.deregister();
}
