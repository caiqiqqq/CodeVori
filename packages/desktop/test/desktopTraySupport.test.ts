import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLinuxTraySupport,
  parseStatusNotifierOwnerOutput,
  resolveCloseToTrayBootstrapValue,
  resolveCloseToTraySupported,
  shouldHideWindowToTray,
} from "../src/main/desktopTraySupport.ts";

test("DBus watcher responses are parsed for supported command variants", () => {
  assert.equal(parseStatusNotifierOwnerOutput("(true,)"), true);
  assert.equal(parseStatusNotifierOwnerOutput("b true"), true);
  assert.equal(parseStatusNotifierOwnerOutput("false"), false);
  assert.equal(parseStatusNotifierOwnerOutput("garbled"), null);
});

test("Linux tray detection falls back across probes and fails closed", async () => {
  const calls: string[] = [];
  const supported = await detectLinuxTraySupport(async (command) => {
    calls.push(command);
    if (command === "gdbus") throw new Error("missing");
    return "b true";
  });
  assert.equal(supported, true);
  assert.deepEqual(calls, ["gdbus", "busctl"]);
  assert.equal(await detectLinuxTraySupport(async () => "(false,)"), false);
  assert.equal(
    await detectLinuxTraySupport(async () => {
      throw new Error("missing");
    }),
    false,
  );
});

test("Linux migration defaults off once and close decision requires a real tray", () => {
  assert.deepEqual(resolveCloseToTrayBootstrapValue("linux", true, false), {
    value: false,
    needsMigration: true,
  });
  assert.deepEqual(resolveCloseToTrayBootstrapValue("linux", true, true), {
    value: true,
    needsMigration: false,
  });
  assert.deepEqual(resolveCloseToTrayBootstrapValue("win32", true, false), {
    value: true,
    needsMigration: false,
  });
  assert.equal(resolveCloseToTraySupported("linux", true, true), true);
  assert.equal(resolveCloseToTraySupported("linux", true, false), false);
  assert.equal(resolveCloseToTraySupported("linux", false, true), false);
  assert.equal(resolveCloseToTraySupported("win32", true, false), true);
});

test("window close hides only when the option and visible tray are both available", () => {
  assert.equal(shouldHideWindowToTray({ platform: "linux", enabled: true, supported: true }), true);
  assert.equal(
    shouldHideWindowToTray({ platform: "linux", enabled: true, supported: false }),
    false,
  );
  assert.equal(
    shouldHideWindowToTray({ platform: "linux", enabled: false, supported: true }),
    false,
  );
  assert.equal(
    shouldHideWindowToTray({ platform: "darwin", enabled: true, supported: true }),
    false,
  );
  assert.equal(
    shouldHideWindowToTray({
      platform: "win32",
      enabled: true,
      supported: true,
      explicitQuitRequested: true,
    }),
    false,
  );
  assert.equal(
    shouldHideWindowToTray({ platform: "win32", enabled: true, supported: true, forceQuit: true }),
    false,
  );
});
