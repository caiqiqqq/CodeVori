import assert from "node:assert/strict";
import test from "node:test";
import {
  createCuaPermissionDragPanel,
  createRealCuaPermissionPanelWindow,
} from "../src/main/cuaPermissionDragPanel.js";

function fixture() {
  let ready = () => {};
  const calls = { created: 0, shown: 0, hidden: 0, destroyed: 0, stopped: 0 };
  const panel = createCuaPermissionDragPanel({
    createWindow: () => {
      calls.created++;
      return {
        onceReadyToShow: (callback) => {
          ready = callback;
        },
        setBounds: () => {},
        showInactive: () => {
          calls.shown++;
        },
        hide: () => {
          calls.hidden++;
        },
        destroy: () => {
          calls.destroyed++;
        },
        isDestroyed: () => calls.destroyed > 0,
        send: () => {},
      };
    },
    getDisplayWorkArea: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    getLocale: () => "zh-CN",
    stopSettingsBounds: () => {
      calls.stopped++;
    },
    logger: { info: () => {}, warn: () => {} },
  });
  return { panel, calls, ready: () => ready() };
}

test("hide before ready-to-show does not reopen the permission panel", () => {
  const { panel, calls, ready } = fixture();
  try {
    panel.show("screen_recording");
    panel.hide();
    ready();
    assert.equal(calls.shown, 0);
  } finally {
    panel.destroy();
  }
});

test("destroy is terminal even when a settings-open or ready callback arrives late", () => {
  const { panel, calls, ready } = fixture();
  panel.show("accessibility");
  panel.destroy();
  ready();
  panel.show("screen_recording");
  panel.destroy();
  assert.deepEqual(calls, { created: 1, shown: 0, hidden: 0, destroyed: 1, stopped: 1 });
});

test("an explicitly hidden live panel may be shown for the next permission stage", () => {
  const { panel, calls, ready } = fixture();
  try {
    panel.show("accessibility");
    ready();
    panel.hide();
    panel.show("screen_recording");
    assert.equal(calls.created, 1);
    assert.equal(calls.shown, 2);
  } finally {
    panel.destroy();
  }
});

test("fullscreen permission panels preserve the app process type without taking focus", () => {
  type WindowDeps = Parameters<typeof createRealCuaPermissionPanelWindow>[0];
  const calls = {
    shown: 0,
    hidden: 0,
    destroyed: 0,
    workspaceVisibility: [] as Array<{ visible: boolean; options: unknown }>,
    levels: [] as Array<{ visible: boolean; level: string }>,
  };
  let windowOptions: Record<string, unknown> = {};
  class PanelWindow {
    webContents = { id: 1 };
    constructor(options: Record<string, unknown>) {
      windowOptions = options;
    }
    async loadFile() {}
    showInactive() {
      calls.shown++;
    }
    setAlwaysOnTop(visible: boolean, level: string) {
      calls.levels.push({ visible, level });
    }
    setVisibleOnAllWorkspaces(visible: boolean, options: unknown) {
      calls.workspaceVisibility.push({ visible, options });
    }
    hide() {
      calls.hidden++;
    }
    destroy() {
      calls.destroyed++;
    }
  }
  const createWindow = createRealCuaPermissionPanelWindow({
    BrowserWindow: PanelWindow as unknown as WindowDeps["BrowserWindow"],
    app: { isPackaged: true },
    preloadPath: "/fixture/preload.cjs",
    rendererDir: "/fixture/renderer",
  });
  const window = createWindow({ x: 0, y: 0, width: 560, height: 124 });

  window.showInactive();
  window.hide();
  window.showInactive();
  window.destroy();

  assert.equal(windowOptions.type, "panel");
  assert.equal(windowOptions.focusable, false);
  assert.equal(windowOptions.skipTaskbar, true);
  assert.equal(windowOptions.show, false);
  assert.equal(calls.shown, 2);
  assert.equal(calls.hidden, 1);
  assert.equal(calls.destroyed, 1);
  assert.deepEqual(calls.levels, [
    { visible: true, level: "screen-saver" },
    { visible: true, level: "screen-saver" },
  ]);
  assert.deepEqual(calls.workspaceVisibility, [
    { visible: true, options: { visibleOnFullScreen: true, skipTransformProcessType: true } },
    { visible: true, options: { visibleOnFullScreen: true, skipTransformProcessType: true } },
  ]);
});
