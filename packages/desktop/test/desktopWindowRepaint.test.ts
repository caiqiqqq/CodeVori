import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { BrowserWindow } from "electron";
import { attachWindowsWindowRepaint } from "../src/main/desktopWindowRepaint.js";

test("Windows focus repaints after occlusion even without show or resize", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let paints = 0;
  let destroyed = false;
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    webContents: { isDestroyed: () => destroyed, invalidate: () => paints++ },
  });
  attachWindowsWindowRepaint(win as unknown as BrowserWindow, "win32");
  win.emit("focus");
  assert.equal(paints, 1);
  t.mock.timers.tick(32);
  assert.equal(paints, 2);
  win.emit("focus");
  win.emit("show");
  assert.equal(paints, 4);
  t.mock.timers.tick(32);
  assert.equal(paints, 5, "repeated focus coalesces only the delayed paint");
  win.emit("resized");
  destroyed = true;
  win.emit("closed");
  t.mock.timers.tick(32);
  assert.equal(paints, 6);
});

test("other platforms do not register Windows repaint handlers", () => {
  const win = new EventEmitter();
  attachWindowsWindowRepaint(win as unknown as BrowserWindow, "darwin");
  assert.equal(win.eventNames().length, 0);
});
