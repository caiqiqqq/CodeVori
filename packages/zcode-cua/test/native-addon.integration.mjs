import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { promisify } from "node:util";
import { createOpenComputerUseService } from "../open-runtime.mjs";

assert.ok(["darwin", "win32"].includes(process.platform), "Run this live test on macOS or Windows");
const directory = await mkdtemp(join(tmpdir(), "codevori-cua-live-"));
const service = createOpenComputerUseService({ env: {} });
let child;
try {
  if (process.platform === "darwin") {
    const app = join(directory, "CodeVoriFixture.app");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await writeFile(
      join(app, "Contents/Info.plist"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.codevori.native-fixture</string><key>CFBundleName</key><string>CodeVoriFixture</string><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>',
    );
    const binary = join(app, "Contents/MacOS/Fixture");
    await promisify(execFile)(
      "swiftc",
      ["-parse-as-library", join(import.meta.dirname, "fixtures/mac-control.swift"), "-o", binary],
      { timeout: 60_000 },
    );
    child = spawn(binary, [], { stdio: "ignore" });
  } else {
    child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(import.meta.dirname, "fixtures/windows-control.ps1"),
      ],
      { stdio: "ignore", windowsHide: false },
    );
  }
  const exited = once(child, "exit");
  const app_ref = { pid: child.pid };
  const read = async (screenshot = false) => {
    const result = await service.callTool("get_app_state", {
      app_ref,
      include_screenshot: screenshot,
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result;
  };
  let initial, last;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await service.callTool("get_app_state", { app_ref });
    last = result;
    if (!result.isError && result.structuredContent.elements.some((node) => node.editable)) {
      initial = result;
      break;
    }
    await pause(200);
  }
  assert.ok(initial, `Owned native fixture exposes an editable tree: ${JSON.stringify(last)}`);
  const field = initial.structuredContent.elements.find((node) => node.editable);
  const set = await service.callTool("set_value", {
    target: { type: "element", state_id: initial.structuredContent.state_id, index: field.index },
    value: "CodeVori native 验证",
  });
  assert.notEqual(set.isError, true, JSON.stringify(set));
  let state = (await read()).structuredContent;
  assert.ok(state.elements.some((node) => node.value === "CodeVori native 验证"));
  const input = state.elements.find((node) => node.editable);
  const typed = await service.callTool("type", {
    target: { type: "element", state_id: state.state_id, index: input.index },
    text: " Typed",
  });
  assert.notEqual(typed.isError, true, JSON.stringify(typed));
  await pause(100);
  state = (await read()).structuredContent;
  assert.ok(
    state.elements.some((node) => node.value?.includes("Typed")),
    "Native typed text reached the fixture",
  );
  const keyed = await service.callTool("key", {
    app_ref,
    text: process.platform === "darwin" ? "cmd+a" : "ctrl+a",
  });
  assert.notEqual(keyed.isError, true, JSON.stringify(keyed));
  await read();
  const replaced = await service.callTool("type", { app_ref, text: "Shortcut native δ" });
  assert.notEqual(replaced.isError, true, JSON.stringify(replaced));
  await pause(100);
  state = (await read()).structuredContent;
  assert.ok(
    state.elements.some((node) => node.value === "Shortcut native δ"),
    `Select-all shortcut must replace the entire text: ${JSON.stringify(state.elements.filter((node) => node.editable))}`,
  );
  if (process.platform === "darwin") {
    const selected = await service.callTool("key", { app_ref, text: "cmd+a" });
    assert.notEqual(selected.isError, true, JSON.stringify(selected));
    await read();
    const pasted = await service.callTool("paste", { app_ref, text: "Pasted native δ" });
    assert.notEqual(pasted.isError, true, JSON.stringify(pasted));
    await pause(100);
    state = (await read()).structuredContent;
    assert.ok(
      state.elements.some((node) => node.value === "Pasted native δ"),
      "Provided paste reached the selected fixture field",
    );
  }
  const button = state.elements.find((node) => node.name === "Increment");
  assert.ok(button, "Fixture button is observable");
  const click = await service.callTool("left_click", {
    target: { type: "element", state_id: state.state_id, index: button.index },
  });
  assert.notEqual(click.isError, true, JSON.stringify(click));
  await pause(100);
  state = (await read()).structuredContent;
  assert.ok(
    state.elements.some((node) => node.value === "Counter: 1" || node.name === "Counter: 1"),
  );
  const image = await read(true);
  assert.ok(image.content.some((part) => part.type === "image" && part.data.length > 100));
  assert.ok(image.structuredContent.image_ref.width > 0);
  const raster = image.structuredContent;
  const rawButton = raster.elements.find((node) => node.name === "Increment");
  const [wx, wy, ww, wh] = raster.window.bounds;
  const [bx, by, bw, bh] = rawButton.bounds;
  const rawClick = await service.callTool("left_click", {
    target: {
      type: "coordinate",
      frame_id: raster.image_ref.frame_id,
      x: Math.round(((bx + bw / 2 - wx) * raster.image_ref.width) / ww),
      y: Math.round(((by + bh / 2 - wy) * raster.image_ref.height) / wh),
    },
    strategy: "event",
  });
  assert.notEqual(rawClick.isError, true, JSON.stringify(rawClick));
  await pause(100);
  state = (await read()).structuredContent;
  assert.ok(
    state.elements.some((node) => node.value === "Counter: 2" || node.name === "Counter: 2"),
    "Raw frame click delivered exactly once",
  );
  const stopped = await service.callTool("stop_computer_control");
  assert.notEqual(stopped.isError, true);
  assert.equal(
    (await service.callTool("list_apps")).structuredContent.code,
    "computer_control_stopped",
  );
  console.log(
    `PASS ${process.platform}-${process.arch}: owned fixture AX/UIA tree, Unicode value, semantic click, verified text/key, frame coordinate click, verified window PNG, stop latch.`,
  );
  await service.close();
  child.kill();
  await exited;
} finally {
  await service.close();
  if (child?.exitCode === null && child?.signalCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
