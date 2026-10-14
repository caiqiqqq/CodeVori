// Production Main dispatcher with an isolated Electron port; never sends OS notifications.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const subject = new URL("../src/main/desktopNotifications.ts", import.meta.url).pathname;
const { outputFiles } = await build({
  stdin: {
    contents: `export {dispatchTaskNotification} from ${JSON.stringify(subject)}; export {state} from 'electron';`,
    resolveDir: new URL("../", import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "isolated-electron-notification-port",
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export const state={windows:[],shown:[]};
            export const app={};
            export const BrowserWindow={getAllWindows:()=>state.windows,fromWebContents:()=>null};
            export class Notification {
              static isSupported(){return true}
              constructor(options){this.options=options}
              once(){return this}
              show(){state.shown.push(this.options)}
            }
          `,
          loader: "js",
        }));
      },
    },
  ],
});
const module = { exports: {} };
runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  process,
  Buffer,
  setTimeout,
  clearTimeout,
});
const { dispatchTaskNotification, state } = module.exports;
let id = 0;
const sends = [];
const warnings = [];
const emit = (patch = {}, taskId = `focus-test-${++id}`) =>
  dispatchTaskNotification({
    event: { sender: { send: (channel) => sends.push(channel) } },
    logger: { info() {}, warn: (...args) => warnings.push(args) },
    payload: { taskId, status: "completed", title: "Synthetic test", body: "Review", ...patch },
  });
const windowWithFocus = (focused) => ({ isDestroyed: () => false, isFocused: () => focused });

test("default and enabled focus suppression checks every app window", () => {
  state.windows = [windowWithFocus(false), windowWithFocus(true)];
  assert.equal(emit(), false);
  assert.equal(emit({ onlyWhenUnfocused: true }), false);
  assert.equal(state.shown.length, 0);
  assert.equal(sends.length, 0);
});

test("disabled focus suppression sends in foreground and keeps sound acknowledgement", () => {
  state.windows = [windowWithFocus(true)];
  assert.equal(emit({ onlyWhenUnfocused: false }), true);
  assert.equal(state.shown.length, 1);
  assert.equal(sends.at(-1), "zcode:task-notification-sound");
  // A later legacy caller must not inherit a previous caller's opt-out.
  assert.equal(emit(), false);
});

test("both choices send in background and preserve native deduplication", () => {
  state.windows = [windowWithFocus(false)];
  assert.equal(emit({ onlyWhenUnfocused: true }), true);
  assert.equal(emit({ onlyWhenUnfocused: false }), true);
  assert.equal(emit(), true);
  const taskId = "focus-test-dedupe";
  assert.equal(emit({ onlyWhenUnfocused: false }, taskId), true);
  assert.equal(emit({ onlyWhenUnfocused: true }, taskId), false);
});

test("IPC rejects a non-boolean focus policy", () => {
  const shownBefore = state.shown.length;
  assert.equal(emit({ onlyWhenUnfocused: "false" }), false);
  assert.equal(state.shown.length, shownBefore);
  assert.equal(warnings.length, 1);
});
