import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "electron";
import {
  decideEmbeddedBrowserPermission,
  installEmbeddedBrowserPermissionBaseline,
} from "../src/main/embeddedBrowserPermissionBaseline.ts";

test("only harmless embedded-browser permissions are silently allowed", () => {
  for (const permission of [
    "clipboard-sanitized-write",
    "fullscreen",
    "pointerLock",
    "mediaKeySystem",
  ]) {
    assert.equal(decideEmbeddedBrowserPermission(permission), true);
  }
  for (const permission of [
    "media",
    "clipboard-read",
    "geolocation",
    "notifications",
    "usb",
    "unknown",
  ]) {
    assert.equal(decideEmbeddedBrowserPermission(permission), false);
  }
});

test("embedded session denies sensitive requests and device selection", () => {
  let request: ((permission: string, callback: (allowed: boolean) => void) => void) | undefined;
  let check: ((permission: string) => boolean) | undefined;
  let device: (() => boolean) | undefined;
  let display: ((callback: (result: unknown) => void) => void) | undefined;
  const events = new Map<string, (...args: never[]) => void>();
  const session = {
    setPermissionRequestHandler(
      handler: NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>,
    ) {
      request = (permission, callback) =>
        handler({} as never, permission as never, callback, {} as never);
    },
    setPermissionCheckHandler(
      handler: NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>,
    ) {
      check = (permission) =>
        handler({} as never, permission as never, "https://example.com", {} as never);
    },
    setDevicePermissionHandler(
      handler: NonNullable<Parameters<Session["setDevicePermissionHandler"]>[0]>,
    ) {
      device = () => handler({} as never);
    },
    setDisplayMediaRequestHandler(
      handler: NonNullable<Parameters<Session["setDisplayMediaRequestHandler"]>[0]>,
    ) {
      display = (callback) => handler({} as never, callback as never);
    },
    on(name: string, handler: (...args: never[]) => void) {
      events.set(name, handler);
    },
  } as unknown as Session;

  installEmbeddedBrowserPermissionBaseline(session, { info() {}, warn() {} });
  assert.ok(request && check && device && display);
  for (const permission of ["media", "clipboard-read", "geolocation", "unknown"]) {
    let result: boolean | undefined;
    request(permission, (allowed) => {
      result = allowed;
    });
    assert.equal(result, false);
    assert.equal(check(permission), false);
  }
  assert.equal(device(), false);
  let displayResult: unknown;
  display((result) => {
    displayResult = result;
  });
  assert.deepEqual(displayResult, {});
  assert.deepEqual([...events.keys()].sort(), [
    "select-hid-device",
    "select-serial-port",
    "select-usb-device",
  ]);
  for (const [name, event] of events) {
    let prevented = false;
    let selection: unknown = "not-called";
    const callback = ((value: unknown) => {
      selection = value;
    }) as never;
    if (name === "select-serial-port") {
      event(
        {
          preventDefault() {
            prevented = true;
          },
        } as never,
        [] as never,
        {} as never,
        callback,
      );
    } else {
      event(
        {
          preventDefault() {
            prevented = true;
          },
        } as never,
        {} as never,
        callback,
      );
    }
    assert.equal(prevented, true);
    assert.notEqual(selection, "not-called");
  }
});
