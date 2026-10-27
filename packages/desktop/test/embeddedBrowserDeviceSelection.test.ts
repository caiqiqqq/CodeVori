import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Session, WebContents, WebFrameMain } from "electron";
import { createEmbeddedBrowserSitePermissionController } from "../src/main/embeddedBrowserSitePermissionController.ts";
import { installEmbeddedBrowserDeviceSelection } from "../src/main/embeddedBrowserDeviceSelection.ts";

function harness() {
  const prompts: { requestId: string; choices?: { id: string }[]; guestWebContentsId: number }[] =
    [];
  const controller = createEmbeddedBrowserSitePermissionController({
    load: async () => ({}),
    save: async () => {},
    timeoutMs: 100,
    sendPrompt: (_host, prompt) => {
      prompts.push(prompt);
      return true;
    },
  });
  const native = new EventEmitter();
  let deviceCheck: (details: any) => boolean;
  let display: (request: any, callback: (source: any) => void) => void;
  const session = Object.assign(native, {
    setDevicePermissionHandler(handler: typeof deviceCheck) {
      deviceCheck = handler;
    },
    setDisplayMediaRequestHandler(handler: typeof display) {
      display = handler;
    },
  });
  const host = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
  const frame = { url: "https://device.example/path" };
  const guest = Object.assign(new EventEmitter(), {
    id: 2,
    hostWebContents: host,
    session,
    mainFrame: frame,
    isDestroyed: () => false,
    getType: () => "webview",
  });
  const source = {
    id: "screen:1",
    name: "Main screen",
    thumbnail: { toDataURL: () => "data:image/png;base64,AA==" },
  };
  const adapter = installEmbeddedBrowserDeviceSelection(session as unknown as Session, controller, {
    fromFrame: (value) => (value === frame ? (guest as unknown as WebContents) : undefined),
    getSources: async () => [source] as never,
    warn() {},
  });
  return {
    controller,
    native,
    host,
    guest,
    frame,
    source,
    adapter,
    prompts,
    check: (details: any) => deviceCheck(details),
    display: (request: any, cb: (source: any) => void) => display(request, cb),
  };
}
const event = { preventDefault() {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("USB chooser validates owner and latest devices; getDevices cannot bypass selection", async () => {
  const h = harness();
  let selected: unknown = "pending";
  const details = {
    origin: "https://device.example",
    deviceType: "usb",
    device: { deviceId: "one" },
  };
  assert.equal(h.check(details), false);
  h.native.emit(
    "select-usb-device",
    event,
    { frame: h.frame, deviceList: [details.device] },
    (id: unknown) => {
      selected = id;
    },
  );
  assert.equal(h.controller.resolve(99, h.prompts[0]!.requestId, "select", "one"), false);
  h.native.emit("usb-device-removed", event, details.device, h.guest);
  assert.deepEqual(h.prompts.at(-1)!.choices, []);
  h.controller.resolve(1, h.prompts[0]!.requestId, "select", "one");
  await tick();
  assert.equal(selected, undefined);
  assert.equal(h.check(details), false);
  h.native.emit(
    "select-usb-device",
    event,
    { frame: h.frame, deviceList: [details.device] },
    (id: unknown) => {
      selected = id;
    },
  );
  h.controller.resolve(1, h.prompts.at(-1)!.requestId, "select", "one");
  await tick();
  assert.equal(selected, "one");
  assert.equal(h.check(details), true);
  assert.equal(h.check({ ...details, origin: "https://other.example" }), false);
  h.native.emit("usb-device-revoked", event, { origin: details.origin, device: details.device });
  assert.equal(h.check(details), false);
});

test("Bluetooth discovery updates one guest chooser; navigation cancels it", async () => {
  const h = harness();
  h.adapter.attachGuest(h.guest as unknown as WebContents);
  let selected = "pending";
  h.guest.emit(
    "select-bluetooth-device",
    event,
    [{ deviceId: "a", deviceName: "A" }],
    (id: string) => {
      selected = id;
    },
  );
  const requestId = h.prompts[0]!.requestId;
  h.guest.emit("select-bluetooth-device", event, [{ deviceId: "b", deviceName: "B" }], () => {
    throw new Error("duplicate callback");
  });
  assert.equal(h.prompts.at(-1)!.requestId, requestId);
  assert.equal(h.prompts.at(-1)!.choices![0]!.id, "b");
  h.guest.emit("did-start-navigation");
  await tick();
  assert.equal(selected, "");
  assert.equal(h.controller.resolve(1, requestId, "select", "b"), false);
  assert.equal(h.guest.listenerCount("did-start-navigation"), 0);
});

test("display selection returns original source, excludes audio, rejects foreign frame and stale replies", async () => {
  const h = harness();
  let selected: any;
  const request = {
    frame: h.frame as unknown as WebFrameMain,
    securityOrigin: "https://device.example",
    videoRequested: true,
    audioRequested: true,
  };
  h.display(request, (result) => {
    selected = result;
  });
  await tick();
  h.controller.resolve(1, h.prompts[0]!.requestId, "select", h.source.id);
  await tick();
  assert.equal(selected.video, h.source);
  assert.equal(selected.audio, undefined);
  h.display({ ...request, frame: null }, (result) => {
    selected = result;
  });
  assert.deepEqual(selected, {});
  h.display(request, (result) => {
    selected = result;
  });
  await tick();
  const id = h.prompts.at(-1)!.requestId;
  await h.controller.clear();
  await tick();
  assert.deepEqual(selected, {});
  assert.equal(h.controller.resolve(1, id, "select", h.source.id), false);
});

test("HID and serial support added candidates, isolate frames and cancel timeout", async () => {
  const h = harness();
  let selected: unknown;
  h.native.emit("select-hid-device", event, { frame: h.frame, deviceList: [] }, (id: unknown) => {
    selected = id;
  });
  h.native.emit("hid-device-added", event, {
    frame: { url: h.frame.url },
    device: { deviceId: "foreign" },
  });
  assert.deepEqual(h.prompts.at(-1)!.choices, []);
  h.native.emit("hid-device-added", event, {
    frame: h.frame,
    device: { deviceId: "hid", productName: "Keyboard" },
  });
  h.controller.resolve(1, h.prompts[0]!.requestId, "select", "hid");
  await tick();
  assert.equal(selected, "hid");
  h.native.emit("select-serial-port", event, [], h.guest, (id: unknown) => {
    selected = id;
  });
  h.native.emit("serial-port-added", event, { portId: "port", portName: "Serial" }, h.guest);
  assert.equal(h.prompts.at(-1)!.choices![0]!.id, "port");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(selected, "");
  assert.equal(h.native.listenerCount("serial-port-added"), 0);
});
