import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { createOpenComputerUseService } from "../open-runtime.mjs";
import { runNativeUtility } from "../vendor/open-zcode-computer-use/src/host-client.mjs";

const nativeDir = resolve(
  import.meta.dirname,
  "../vendor/open-zcode-computer-use/native/.build/debug",
);
const executable = resolve(process.argv[2] ?? `${nativeDir}/OpenZCodeNative`);
const initialFront = await runNativeUtility("frontmost", [], { executable });
const fixture = spawn(`${nativeDir}/OpenZCodeFixture`, [], {
  env: {
    ...process.env,
    OPEN_COMPUTER_USE_FIXTURE_HEADLESS: "0",
    OPEN_COMPUTER_USE_FIXTURE_FLOATING: "1",
  },
  stdio: "ignore",
});
const exited = once(fixture, "exit");
const service = createOpenComputerUseService({ executable });
function payload(result, key) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  for (const item of result.content ?? []) {
    if (item.type === "text") {
      const value = JSON.parse(item.text);
      if (key in value) return value;
    }
  }
  throw new Error(`Missing ${key}`);
}
const observe = async (include_screenshot = false) =>
  payload(
    await service.callTool("get_app_state", {
      app_ref: { pid: fixture.pid },
      detail: "full",
      include_screenshot,
    }),
    "state_id",
  );
async function until(read, accepts, description) {
  const end = Date.now() + 10000;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await pause(100);
  } while (Date.now() < end);
  throw new Error(description);
}
const counter = (state) =>
  state?.elements.find((e) => e.identifier === "fixture-counter-label")?.value;
try {
  // 等待自己的进程建立窗口；不启动或复用用户已有的同名窗口。
  await until(
    async () => {
      const result = await service.callTool("list_windows", { app_ref: { pid: fixture.pid } });
      return result.isError ? null : JSON.stringify(result);
    },
    (v) => v?.includes("OpenComputerUseFixture"),
    "AppKit fixture readiness",
  );
  await until(
    async () => {
      const result = await service.callTool("get_app_state", {
        app_ref: { pid: fixture.pid },
        detail: "full",
        include_screenshot: false,
      });
      if (result.isError && result.structuredContent?.code === "window_gone") return null;
      return payload(result, "state_id");
    },
    (s) => counter(s) === "Counter: 0",
    "initial counter",
  );
  await runNativeUtility("activate", [String(fixture.pid)], { executable });
  for (const [expected, background, count] of [
    [1, false, 1],
    [2, true, 1],
    [4, true, 2],
  ]) {
    if (background && initialFront.pid)
      await runNativeUtility("activate", [String(initialFront.pid)], { executable });
    const state = await observe(true);
    const button = state.elements.find((e) => e.identifier === "fixture-increment");
    assert.ok(button?.bounds);
    // 夹具的 AX 几何仅用作测试 oracle；这里明确验证无 AXPress 的原始派发。
    const scale = state.image_ref.width / state.window.bounds[2];
    const point = {
      type: "coordinate",
      x: Math.round((button.bounds[0] - state.window.bounds[0] + button.bounds[2] / 2) * scale),
      y: Math.round((button.bounds[1] - state.window.bounds[1] + button.bounds[3] / 2) * scale),
    };
    const cursorBefore = await runNativeUtility("cursor", [], { executable });
    const receipt = payload(
      await service.callTool(count === 2 ? "double_click" : "left_click", {
        target: point,
        strategy: "event",
      }),
      "action_receipt",
    ).action_receipt;
    assert.equal(receipt.action_sent, true);
    await until(
      observe,
      (s) => counter(s) === `Counter: ${expected}`,
      `one AppKit click delivered (${background ? "background" : "foreground"})`,
    );
    await pause(150);
    assert.equal(counter(await observe()), `Counter: ${expected}`, "no duplicate delivery");
    assert.deepEqual(
      await runNativeUtility("cursor", [], { executable }),
      cursorBefore,
      "cursor must not move",
    );
    assert.equal(
      (await runNativeUtility("frontmost", [], { executable })).pid,
      background && initialFront.pid ? initialFront.pid : fixture.pid,
      "foreground owner must not change",
    );
  }
  console.log(
    "PASS: foreground/background AppKit raw clicks deliver exactly once, preserve focus and cursor.",
  );
} finally {
  if (
    (await runNativeUtility("frontmost", [], { executable })).pid === fixture.pid &&
    initialFront.pid
  )
    await runNativeUtility("activate", [String(initialFront.pid)], { executable });
  await service.close();
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
  await exited;
}
