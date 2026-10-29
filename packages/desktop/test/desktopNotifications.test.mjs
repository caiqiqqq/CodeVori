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
            export const state={windows:[],shown:[],instances:[],focus:[]};
            export const app={dock:{show(){}},show(){},focus(){}};
            export const BrowserWindow={getAllWindows:()=>state.windows,fromWebContents:()=>state.senderWindow??null};
            export class Notification {
              static isSupported(){return true}
              constructor(options){this.options=options;this.handlers={}}
              once(event,handler){this.handlers[event]=handler;return this}
              show(){state.shown.push(this.options);state.instances.push(this)}
            }
          `,
          loader: "js",
        }));
      },
    },
  ],
});
let notificationNow = Date.now();
const module = { exports: {} };
runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  process,
  Buffer,
  Date: class extends Date {
    static now() {
      return notificationNow;
    }
  },
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

test("repository issue receipts dedupe windows polling a minute apart without extending task dedupe", () => {
  state.windows = [windowWithFocus(false)];
  const taskId = "repository-issue-repo-42";
  assert.equal(emit({ status: "repository_issue" }, taskId), true);
  notificationNow += 60_000;
  assert.equal(emit({ status: "repository_issue" }, taskId), false);
  assert.equal(emit({ status: "repository_issue" }, "repository-issue-other-repo-42"), true);
  assert.equal(emit({}, "repeat-task"), true);
  notificationNow += 4000;
  assert.equal(emit({}, "repeat-task"), true);
  notificationNow += 24 * 60 * 60 * 1000;
  assert.equal(emit({ status: "repository_issue" }, taskId), true);
});

test("native issue notification click restores the originating window and forwards stable identity", () => {
  const forwarded = [];
  state.senderWindow = {
    id: 7,
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => state.focus.push("restore"),
    show: () => state.focus.push("show"),
    focus: () => state.focus.push("focus"),
    webContents: { send: (...args) => forwarded.push(args) },
  };
  state.windows = [];
  try {
    assert.equal(emit({ status: "repository_issue" }, "repository-native-click-42"), true);
    state.instances.at(-1).handlers.click();
    assert.deepEqual(Array.from(state.focus), ["restore", "show", "focus"]);
    assert.deepEqual(forwarded, [["zcode:task-notification-click", "repository-native-click-42"]]);
  } finally {
    state.senderWindow = null;
  }
});
