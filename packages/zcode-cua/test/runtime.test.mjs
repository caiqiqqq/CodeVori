import assert from "node:assert/strict";
import test from "node:test";
import { createComputerUseRuntime } from "../index.js";

const context = (overrides = {}) => ({
  sessionId: "session-1",
  workspaceKey: "workspace-1",
  runtimeScope: "main",
  clientMode: "desktop-continuous",
  ...overrides,
});

function fixture(options = {}) {
  const calls = [];
  const closed = [];
  const runtime = createComputerUseRuntime({
    platform: "linux",
    ...options,
    createService: (key) => ({
      async callTool(name, args) {
        calls.push({ key, name, args });
        if (name === "get_app_state") {
          return {
            content: [
              { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
              { type: "text", text: JSON.stringify({ image_ref: { frame_id: `frame-${key}` } }) },
              {
                type: "text",
                text: JSON.stringify({
                  state_id: `state-${key}`,
                  app: { pid: args.app_ref.pid, name: "Editor" },
                  window: { window_id: 7, title: "Document" },
                  elements: [{ index: 0, kind: "button", name: "Save", enabled: true }],
                  image_ref: { frame_id: `frame-${key}` },
                }),
              },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ action_receipt: { action_sent: true } }) },
          ],
        };
      },
      async close() {
        closed.push(key);
      },
    }),
  });
  return { runtime, calls, closed };
}

async function execute(runtime, toolName, args = {}, ctx = context(), signal) {
  return runtime.execute({ toolName, arguments: args, context: ctx, signal });
}

test("all 14 official methods dispatch through the same session", async () => {
  const { runtime, calls } = fixture();
  const app_ref = { pid: 42 };
  const target = { type: "element", index: 0 };
  const methods = [
    ["list_apps", {}],
    ["list_windows", { app_ref }],
    ["get_app_state", { app_ref }],
    ["left_click", { app_ref, target }],
    ["scroll", { app_ref, target, scroll_direction: "down", scroll_amount: 1 }],
    ["left_click_drag", { app_ref, from_target: target, to: target }],
    ["type", { app_ref, text: "hello" }],
    ["set_value", { app_ref, target, value: "hello" }],
    ["select_text", { app_ref, target, text_range: [0, 1] }],
    ["key", { app_ref, text: "enter" }],
    ["perform_action", { app_ref, target, action: "press" }],
    ["paste", { app_ref, text: "hello" }],
    ["request_access", {}],
    ["stop_computer_control", {}],
  ];
  for (const [toolName, args] of methods) {
    const result = await execute(runtime, toolName, args);
    assert.notEqual(result.isError, true, toolName);
    if (toolName === "get_app_state") {
      assert.equal(result.structuredContent.text, "[0] button Save");
      assert.equal(result.content[0].type, "image");
    }
  }
  assert.deepEqual(
    calls.map(({ name }) => name),
    methods.map(([name]) => name),
  );
  assert.equal(calls[3].args.target.state_id, "state-workspace-1\0__local__\0session-1");
  await runtime.dispose();
});

test("runtime session keys include remote identity and keep state authority separate", async () => {
  const { runtime, calls, closed } = fixture();
  const local = context();
  const remote = context({ remoteSessionId: "remote-1", clientMode: "web-remote-replayable" });
  await execute(runtime, "get_app_state", { app_ref: { pid: 42 } }, local);
  const missing = await execute(
    runtime,
    "left_click",
    {
      app_ref: { pid: 42 },
      target: { type: "element", index: 0 },
    },
    remote,
  );
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.action_sent, false);
  assert.equal(calls.length, 1);
  await execute(runtime, "get_app_state", { app_ref: { pid: 42 } }, remote);
  await runtime.closeSession(local);
  assert.equal(closed.length, 1);
  await runtime.dispose();
  assert.equal(closed.length, 2);
});

test("coordinate targets use the latest frame of the requested app", async () => {
  const { runtime, calls } = fixture();
  await execute(runtime, "get_app_state", { app_ref: { pid: 42 } });
  await execute(runtime, "left_click", {
    app_ref: { pid: 42 },
    target: { type: "coordinate", x: 10, y: 20 },
  });
  assert.equal(calls[1].args.target.frame_id, "frame-workspace-1\0__local__\0session-1");
  const mismatched = await execute(runtime, "left_click", {
    app_ref: { pid: 43 },
    target: { type: "coordinate", x: 10, y: 20 },
  });
  assert.equal(mismatched.isError, true);
  assert.equal(calls.length, 2);
  await runtime.dispose();
});

test("mismatched app identity cannot publish state or dispatch keyboard input", async () => {
  const { runtime, calls } = fixture();
  const mismatch = await execute(runtime, "get_app_state", {
    app_ref: { pid: 42, bundle_id: "another.app" },
  });
  assert.equal(mismatch.isError, true);
  assert.equal(mismatch.structuredContent.action_sent, false);
  const key = await execute(runtime, "key", { app_ref: { pid: 42 }, text: "enter" });
  assert.equal(key.isError, true);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["get_app_state"],
  );
  await runtime.dispose();
});

test("subagents, invalid calls, stopped sessions and missing backends fail before input", async () => {
  const { runtime, calls } = fixture();
  for (const result of [
    await execute(runtime, "list_apps", {}, context({ runtimeScope: "subagent" })),
    await execute(runtime, "unknown", {}),
    await execute(runtime, "left_click", { target: { type: "coordinate", x: -1, y: 0 } }),
    await execute(runtime, "left_click", {
      app_ref: { pid: 42 },
      target: { type: "element", index: 0, extra: true },
    }),
    await execute(runtime, "get_app_state", { app_ref: { pid: 42, extra: true } }),
  ]) {
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.action_sent, false);
  }
  assert.equal(calls.length, 0);
  await execute(runtime, "stop_computer_control");
  assert.equal((await execute(runtime, "list_apps")).isError, true);
  await runtime.dispose();

  const unavailable = createComputerUseRuntime({ platform: "win32" });
  const failure = await execute(unavailable, "list_apps");
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.code, "action_unavailable");
  assert.equal(failure.structuredContent.request_delivery_state, "not_sent");
  await unavailable.dispose();

  const signedBroker = createComputerUseRuntime({
    platform: "darwin",
    macOsVersion: "14.0",
    brokerSocketPath: "/tmp/signed-helper.sock",
  });
  const brokerFailure = await execute(signedBroker, "list_apps");
  assert.equal(brokerFailure.isError, true);
  assert.equal(brokerFailure.structuredContent.request_delivery_state, "not_sent");
  await signedBroker.dispose();
});

test("aborted queued commands do not dispatch", async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const calls = [];
  const runtime = createComputerUseRuntime({
    platform: "linux",
    createService: () => ({
      async callTool(name) {
        calls.push(name);
        if (name === "list_apps") {
          entered();
          await gate;
        }
        return { content: [] };
      },
      async close() {},
    }),
  });
  const first = execute(runtime, "list_apps");
  await ready;
  const controller = new AbortController();
  const second = execute(
    runtime,
    "list_windows",
    { app_ref: { pid: 42 } },
    context(),
    controller.signal,
  );
  controller.abort();
  release();
  await first;
  const result = await second;
  assert.equal(result.structuredContent.request_delivery_state, "not_sent");
  assert.deepEqual(calls, ["list_apps"]);
  await runtime.dispose();
});

test("macOS click options and held keys map to native operations", async () => {
  const { runtime, calls } = fixture({ platform: "darwin", macOsVersion: "14.0" });
  const app_ref = { pid: 42 };
  await execute(runtime, "get_app_state", { app_ref });
  const target = { type: "element", index: 0 };
  for (const [mouse_button, click_count] of [
    ["left", 2],
    ["left", 3],
    ["right", 1],
    ["middle", 1],
  ]) {
    const result = await execute(runtime, "left_click", {
      app_ref,
      target,
      mouse_button,
      click_count,
    });
    assert.notEqual(result.isError, true);
  }
  await execute(runtime, "key", { app_ref, text: "enter", hold_seconds: 0.2 });
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["get_app_state", "double_click", "triple_click", "right_click", "middle_click", "hold_key"],
  );
  assert.equal(calls.at(-1).args.duration, 0.2);
  const paste = await execute(runtime, "paste", { app_ref, text: "hello" });
  assert.equal(paste.isError, true);
  assert.equal(paste.structuredContent.action_sent, false);
  assert.equal(calls.at(-1).name, "hold_key");
  await runtime.dispose();
});
