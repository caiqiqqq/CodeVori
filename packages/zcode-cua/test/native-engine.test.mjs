import assert from "node:assert/strict";
import test from "node:test";
import { NativeEngine } from "../native-engine.mjs";

const app = { pid: 42, bundle_id: "example.editor", name: "Editor", active: true };
const win = { window_id: 7, bounds: [10, 20, 200, 100], title: "Fixture", focused: true };
const element = {
  ref: "private-handle",
  role: "AXTextField",
  title: "Input",
  value: "",
  enabled: true,
  editable: true,
  ownerPid: 42,
  bounds: [20, 30, 120, 30],
  actions: ["AXPress"],
  children: [],
};
const png = Buffer.alloc(32);
Buffer.from("89504e470d0a1a0a", "hex").copy(png);
png.writeUInt32BE(400, 16);
png.writeUInt32BE(200, 20);

function fixture(platform = "win32") {
  const calls = [];
  let snapshot = {
    app: structuredClone(app),
    window: structuredClone(win),
    elements: [structuredClone(element)],
  };
  const native = {
    isTrusted: () => true,
    screenCaptureStatus: () => "granted",
    isInteractiveSession: () => true,
    isTargetElevated: () => false,
    listApplications: () => [snapshot.app],
    applicationInfo: () => snapshot.app,
    listWindows: () => [snapshot.window],
    captureApp: () => snapshot,
    captureAppAsync: async () => snapshot,
    captureWindowPngVerifiedAsync: async (...args) => {
      calls.push(["capture", ...args]);
      return { ok: true, data: png, bounds: win.bounds };
    },
    captureWindowImageVerifiedAsync: async () => ({
      data: png.toString("base64"),
      bounds: win.bounds,
    }),
    readElement: () => snapshot.elements[0],
    performAction: (...args) => {
      calls.push(["press", ...args]);
      return { ok: true };
    },
    setValue: (...args) => {
      calls.push(["value", ...args]);
      return true;
    },
    setFocused: () => true,
    typeTextGlobal: (...args) => {
      calls.push(["type", ...args]);
      return { ok: true };
    },
    pressKeyGlobal: (...args) => {
      calls.push(["key", ...args]);
      return { ok: true };
    },
    isFocusStealPrevented: () => false,
    activateWindow: () => true,
    clickAtPoint: (...args) => {
      calls.push(["click", ...args]);
      return true;
    },
  };
  let now = 1000;
  const engine = new NativeEngine({ native, platform, now: () => now });
  return {
    engine,
    native,
    calls,
    snapshot,
    expire: () => {
      now += 30001;
    },
  };
}

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: observation issues safe handles and semantic input is scoped`, async () => {
    const { engine, calls } = fixture(platform);
    const state = await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
    assert.equal(state.isError, undefined);
    assert.equal(JSON.stringify(state).includes("private-handle"), false);
    const target = { type: "element", state_id: state.structuredContent.state_id, index: 0 };
    const result = await engine.callTool("set_value", { target, value: "你好" });
    assert.notEqual(result.isError, true);
    assert.deepEqual(calls, [["value", "private-handle", "你好"]]);
    assert.equal(
      (await engine.callTool("set_value", { target, value: "again" })).structuredContent.code,
      "stale_state",
    );
  });
}

test("Windows screenshot coordinates map raster pixels to the exact native window", async () => {
  const { engine, calls } = fixture();
  const state = await engine.callTool("get_app_state", {
    app_ref: { pid: 42 },
    include_screenshot: true,
  });
  const frame = state.structuredContent.image_ref.frame_id;
  const result = await engine.callTool("left_click", {
    target: { type: "coordinate", frame_id: frame, x: 100, y: 40 },
    strategy: "event",
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls.at(-1), ["click", 60, 40, "left", 1, "", 42, 7]);
  assert.deepEqual(calls[0], ["capture", 7, 42, "example.editor", win.bounds]);
});

test("foreign, expired and changed window/owner targets never send input", async () => {
  for (const mode of [
    "foreign",
    "expired",
    "window",
    "owner",
    "bounds",
    "element",
    "label",
    "value",
  ]) {
    const { engine, calls, snapshot, expire, native } = fixture();
    const state = await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
    const target = { type: "element", state_id: state.structuredContent.state_id, index: 0 };
    if (mode === "foreign") target.state_id = "foreign";
    if (mode === "expired") expire();
    if (mode === "window") snapshot.window.window_id = 8;
    if (mode === "owner") snapshot.app.bundle_id = "different.exe";
    if (mode === "bounds") snapshot.window.bounds = [20, 20, 200, 100];
    if (mode === "label") native.readElement = () => ({ ...element, title: "Different action" });
    if (mode === "value") native.readElement = () => ({ ...element, value: "User changed this" });
    if (mode === "element") native.readElement = () => ({ ...element, ownerPid: 99 });
    const result = await engine.callTool("left_click", { target });
    assert.equal(result.isError, true, mode);
    assert.deepEqual(calls, [], mode);
  }
});

test("native rejection never falls back or retries; observation is consumed", async () => {
  const { engine, native, calls } = fixture();
  native.performAction = () => {
    calls.push(["rejected"]);
    return { ok: false, axError: "unavailable" };
  };
  const state = await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
  const target = { type: "element", state_id: state.structuredContent.state_id, index: 0 };
  const result = await engine.callTool("left_click", { target });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.request_delivery_state, "possibly_sent");
  assert.equal((await engine.callTool("left_click", { target })).isError, true);
  assert.deepEqual(calls, [["rejected"]]);
});

test("Windows elevated/noninteractive targets and stop latch deny input", async () => {
  for (const blocked of ["elevated", "noninteractive", "stopped"]) {
    const { engine, native, calls } = fixture();
    if (blocked === "elevated") native.isTargetElevated = () => true;
    if (blocked === "noninteractive") native.isInteractiveSession = () => false;
    if (blocked === "stopped") await engine.callTool("stop_computer_control", {});
    const result = await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
    assert.equal(result.isError, true);
    assert.deepEqual(calls, []);
  }
});

test("macOS shortcuts use the foreground primitive once and never retry via PID", async () => {
  const { engine, native, calls } = fixture("darwin");
  native.isFocusStealPrevented = () => false;
  native.pressKeyGlobal = (text) => {
    calls.push(["foreground-key", text]);
    return { ok: false, error: "dispatch_failed" };
  };
  await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
  const result = await engine.callTool("key", { app_ref: { pid: 42 }, text: "cmd+a" });
  assert.equal(result.structuredContent.request_delivery_state, "possibly_sent");
  assert.deepEqual(calls, [["foreground-key", "cmd+a"]]);
});

test("capture display title and raw accessibility description identify the same field", async () => {
  const { engine, native, snapshot } = fixture("darwin");
  snapshot.elements[0].description = "Input";
  native.readElement = () => ({ ...snapshot.elements[0], title: undefined });
  const result = await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
  const updated = await engine.callTool("set_value", {
    target: { type: "element", state_id: result.structuredContent.state_id, index: 0 },
    value: "new",
  });
  assert.notEqual(updated.isError, true);
});

test("macOS focus/no-focus changes block shortcuts before dispatch", async () => {
  for (const mode of ["inactive", "window", "policy"]) {
    const { engine, native, calls, snapshot } = fixture("darwin");
    native.isFocusStealPrevented = () => mode === "policy";
    native.pressKeyGlobal = () => {
      calls.push(["unexpected"]);
      return true;
    };
    await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
    native.activateWindow = () => {
      if (mode === "inactive") snapshot.app.active = false;
      if (mode === "window") snapshot.window.focused = false;
      return true;
    };
    const result = await engine.callTool("key", { app_ref: { pid: 42 }, text: "cmd+v" });
    assert.equal(result.isError, true, mode);
    assert.equal(result.structuredContent.action_sent, false, mode);
    assert.deepEqual(calls, [], mode);
  }
});

test("Windows keyboard uses its actual foreground ABI without macOS PID methods", async () => {
  const { engine, native, calls } = fixture("win32");
  assert.equal(native.pressKeyToPidVerified, undefined);
  assert.equal(native.typeTextToPidVerified, undefined);
  await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
  assert.notEqual(
    (await engine.callTool("key", { app_ref: { pid: 42 }, text: "ctrl+a" })).isError,
    true,
  );
  await engine.callTool("get_app_state", { app_ref: { pid: 42 } });
  assert.notEqual(
    (await engine.callTool("type", { app_ref: { pid: 42 }, text: "Hello δ" })).isError,
    true,
  );
  assert.deepEqual(calls, [
    ["key", "ctrl+a"],
    ["type", "Hello δ"],
  ]);
});
