import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { ComputerUseService } from "../src/computer-use-service.mjs";
import { HostTransportError, MockHostClient } from "../src/host-client.mjs";

function snapshot(id = "snap-1") {
  return {
    snapshotId: id,
    capturedAt: 1,
    target: {
      pid: 42,
      windowId: 7,
      appId: "dev.example.fixture",
      appName: "Fixture",
      title: "Fixture",
      bounds: { x: 100, y: 200, width: 400, height: 300 },
      layer: 0,
      zIndex: 10,
      displayId: "1",
    },
    windowDigest: `sha256:${id}`,
    focusedElementToken: "el-text",
    selectedText: null,
    image: null,
    displays: [],
    obscuringRects: [],
    truncated: { elements: false, depth: false },
    difference: null,
    elements: [
      {
        token: "el-button",
        stableId: 1,
        parentToken: null,
        depth: 0,
        role: "AXButton",
        subrole: null,
        axIdentifier: "increment",
        title: "Increment",
        label: null,
        value: null,
        placeholder: null,
        enabled: true,
        focused: false,
        selected: null,
        frame: { x: 20, y: 30, width: 80, height: 30 },
        actions: ["press"],
        digest: "sha256:button",
        truncated: [],
      },
      {
        token: "el-text",
        stableId: 2,
        parentToken: null,
        depth: 0,
        role: "AXTextField",
        subrole: null,
        axIdentifier: "input",
        title: null,
        label: "Input",
        value: "abc",
        placeholder: null,
        enabled: true,
        focused: true,
        selected: null,
        frame: { x: 20, y: 80, width: 200, height: 30 },
        actions: [],
        digest: "sha256:text",
        truncated: [],
      },
    ],
  };
}

function mockService() {
  const host = new MockHostClient({
    responses: {
      "apps.list": {
        ok: true,
        apps: [{
          appId: "dev.example.fixture",
          pid: 42,
          name: "Fixture",
          running: true,
          windowCount: 1,
        }],
      },
      "window.list": {
        ok: true,
        windows: [{
          pid: 42,
          windowId: 7,
          appId: "dev.example.fixture",
          appName: "Fixture",
          title: "Fixture",
          bounds: { x: 100, y: 200, width: 400, height: 300 },
          layer: 0,
          zIndex: 10,
          onScreen: true,
          displayId: "1",
        }],
      },
      observe: { ok: true, snapshot: snapshot() },
      "dispatch.element": {
        ok: true,
        toolCallId: "call",
        outcome: "ok",
        tier: "ax",
        path: "ax_action",
        effect: "confirmed",
        verification: { method: "action_result", observedChange: true },
        settle: { waitedMs: 0, quiesced: true, reason: "not_requested" },
        snapshot: null,
        postObservationError: null,
      },
      "permissions.check": {
        ok: true,
        accessibility: true,
        screenRecording: true,
        screenRecordingProbe: "capture_succeeded",
      },
    },
  });
  return { host, service: new ComputerUseService({ host }) };
}

test("separate-instance launch resolves localized names natively and pins the returned bundle", async () => {
  const { host } = mockService();
  let launched = false;
  host.responses["apps.list"] = () => ({
    ok: true,
    apps: launched ? [
      { appId: "com.parallels.winapp.fixture", pid: 50, name: "计算器" },
      { appId: "com.apple.calculator", pid: 51, name: "Calculator" },
    ] : [],
  });
  const service = new ComputerUseService({
    host,
    nativeUtility: async (command, args) => {
      assert.equal(command, "resolve-app");
      assert.deepEqual(args, ["计算器"]);
      return { bundle_id: "com.apple.calculator" };
    },
    runProcess: async (command, args) => {
      assert.equal(command, "/usr/bin/open");
      assert.deepEqual(args, ["-g", "-n", "-b", "com.apple.calculator"]);
      launched = true;
    },
  });
  await service.start();
  const result = await service.callTool("open_application", { app: { name: "计算器" }, new_instance: true });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const app = JSON.parse(result.content[0].text);
  assert.equal(app.bundle_id, "com.apple.calculator");
  assert.equal(app.pid, 51);
});

test("PID-only activation reuses the exact process and refuses an unknown PID", async () => {
  const { host } = mockService();
  const activations = [];
  const service = new ComputerUseService({
    host,
    nativeUtility: async (command, args) => {
      assert.equal(command, "activate");
      activations.push(args);
      return { activated: true, active: true };
    },
  });
  await service.start();
  const result = await service.callTool("open_application", { app: { pid: 42 }, activate: true });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).pid, 42);
  assert.deepEqual(activations, [["42"]]);
  assert.equal(host.calls.some(call => call.method === "apps.launch"), false);
  const missing = await service.callTool("open_application", { app: { pid: 999 }, activate: true });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.action_sent, false);
  assert.equal(activations.length, 1);
});

test("URL launch keeps the resolved bundle identity and stays in the background", async () => {
  const { host } = mockService();
  host.responses["apps.launch"] = { ok: true, pid: 42, appId: "com.apple.calculator", name: "计算器" };
  const launches = [];
  const service = new ComputerUseService({
    host,
    runProcess: async (command, args) => { launches.push({ command, args }); },
  });
  await service.start();
  const result = await service.callTool("open_application", { app: { name: "计算器", url: "https://example.com/" } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(launches, [{ command: "/usr/bin/open", args: ["-g", "-b", "com.apple.calculator", "https://example.com/"] }]);
});

test("get_app_state maps native tokens into a session-local state id", async () => {
  const { service } = mockService();
  await service.start();
  const result = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "full",
  });
  assert.equal(result.isError, undefined);
  const state = JSON.parse(result.content[0].text);
  assert.equal(state.state_id, "s-1");
  assert.equal(state.elements[0].name, "Increment");
  assert.deepEqual(state.elements[0].bounds, [120, 230, 80, 30]);
  assert.equal(JSON.stringify(state).includes("el-button"), false);
});

test("element mutation consumes the referenced state and returns a receipt", async () => {
  const { host, service } = mockService();
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "compact",
  });
  const state = JSON.parse(observed.content[0].text);
  const clicked = await service.callTool("left_click", {
    target: { type: "element", state_id: state.state_id, index: 0 },
  });
  const receipt = JSON.parse(clicked.content[0].text).action_receipt;
  assert.equal(receipt.action_sent, true);
  assert.equal(receipt.path, "ax_action");
  assert.equal(host.calls.at(-1).method, "dispatch.element");

  const replay = await service.callTool("left_click", {
    target: { type: "element", state_id: state.state_id, index: 0 },
  });
  assert.equal(replay.isError, true);
  assert.match(replay.content[0].text, /spent/u);
});

test("auto coordinate click prefers an accessibility action at the hit point", async () => {
  const { host, service } = mockService();
  await writeFile("/tmp/open-zcode-fixture.png", "fixture");
  host.responses.observe = {
    ok: true,
    snapshot: {
      ...snapshot(),
      image: {
        path: "/tmp/open-zcode-fixture.png",
        format: "png",
        widthPx: 800,
        heightPx: 600,
        scale: 2,
        sha256: null,
      },
    },
  };
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "full",
  });
  const state = JSON.parse(
    observed.content.find((item) => item.type === "text" && item.text.includes("\"state_id\"")).text,
  );
  const clicked = await service.callTool("left_click", {
    target: {
      type: "coordinate",
      frame_id: state.image_ref.frame_id,
      x: 120,
      y: 90,
    },
    strategy: "auto",
  });
  assert.equal(clicked.isError, undefined);
  assert.equal(host.calls.at(-1).method, "dispatch.element");
  assert.equal(host.calls.at(-1).params.elementToken, "el-button");
});

test("drag resolves both frame coordinates against one native snapshot", async () => {
  const { host, service } = mockService();
  await writeFile("/tmp/open-zcode-drag.png", "fixture");
  host.responses.observe = {
    ok: true,
    snapshot: {
      ...snapshot(),
      image: {
        path: "/tmp/open-zcode-drag.png",
        format: "png",
        widthPx: 800,
        heightPx: 600,
        scale: 2,
        sha256: null,
      },
    },
  };
  host.responses["dispatch.point"] = {
    ok: true,
    outcome: "ok",
    path: "cg_event_pid",
    effect: "unverifiable",
  };
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "full",
    include_screenshot: true,
  });
  const state = JSON.parse(
    observed.content.find((item) => item.type === "text" && item.text.includes("\"state_id\"")).text,
  );
  const result = await service.callTool("left_click_drag", {
    from_target: { type: "coordinate", frame_id: state.image_ref.frame_id, x: 40, y: 40 },
    to: { type: "coordinate", frame_id: state.image_ref.frame_id, x: 200, y: 160 },
  });
  assert.equal(result.isError, undefined);
  const dispatch = host.calls.at(-1);
  assert.equal(dispatch.method, "dispatch.point");
  assert.equal(dispatch.params.snapshotId, "snap-1");
  assert.deepEqual(dispatch.params.startPoint, { x: 40, y: 40 });
  assert.deepEqual(dispatch.params.point, { x: 200, y: 160 });
});

test("coordinate type resolves an editable element and uses set_value", async () => {
  const { host, service } = mockService();
  await writeFile("/tmp/open-zcode-type.png", "fixture");
  host.responses.observe = {
    ok: true,
    snapshot: {
      ...snapshot(),
      image: {
        path: "/tmp/open-zcode-type.png",
        format: "png",
        widthPx: 800,
        heightPx: 600,
        scale: 2,
        sha256: null,
      },
    },
  };
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "compact",
    include_screenshot: true,
  });
  const state = JSON.parse(
    observed.content.find((item) => item.type === "text" && item.text.includes("\"state_id\"")).text,
  );
  const result = await service.callTool("type", {
    text: "replacement",
    target: {
      type: "coordinate",
      frame_id: state.image_ref.frame_id,
      x: 240,
      y: 190,
    },
    strategy: "auto",
  });
  assert.equal(result.isError, undefined);
  const dispatch = host.calls.at(-1);
  assert.equal(dispatch.method, "dispatch.element");
  assert.deepEqual(dispatch.params.action, {
    kind: "set_value",
    value: "replacement",
  });
});

test("select_text without a range places the caret", async () => {
  const { host, service } = mockService();
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "full",
  });
  const state = JSON.parse(observed.content[0].text);
  const result = await service.callTool("select_text", {
    target: { type: "element", state_id: state.state_id, index: 1 },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(host.calls.at(-1).params.action, {
    kind: "select_text",
    text: "",
  });
});

test("possibly-sent transport errors invalidate the source state", async () => {
  const { host, service } = mockService();
  host.responses["dispatch.element"] = () => {
    throw new HostTransportError("connection lost", { delivery: "possibly_sent" });
  };
  await service.start();
  const observed = await service.callTool("get_app_state", {
    app_ref: { pid: 42 },
    detail: "compact",
  });
  const state = JSON.parse(observed.content[0].text);
  const first = await service.callTool("left_click", {
    target: { type: "element", state_id: state.state_id, index: 0 },
  });
  assert.equal(first.isError, true);
  assert.equal(first.structuredContent.request_delivery_state, "possibly_sent");
  const replay = await service.callTool("left_click", {
    target: { type: "element", state_id: state.state_id, index: 0 },
  });
  assert.equal(replay.isError, true);
  assert.match(replay.content[0].text, /outcome_unknown/u);
});

test("mouse up refuses when this session does not own a prior mouse down", async () => {
  const { service } = mockService();
  await service.start();
  const result = await service.callTool("left_mouse_up", {});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.action_receipt.action_sent, false);
});

test("kill switch is latched and request_access remains readable", async () => {
  const { service } = mockService();
  await service.start();
  const stopped = await service.callTool("stop_computer_control", { reason: "user" });
  assert.equal(JSON.parse(stopped.content[0].text).stopped, true);
  const denied = await service.callTool("list_apps", {});
  assert.equal(denied.isError, true);
  const permissions = await service.callTool("request_access", {});
  assert.equal(permissions.isError, undefined);
});
