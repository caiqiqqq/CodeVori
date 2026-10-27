import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { createOpenComputerUseService } from "../../zcode-cua/open-runtime.mjs";
import { ComputerUseService } from "../../zcode-cua/vendor/open-zcode-computer-use/src/computer-use-service.mjs";
import {
  HostClient,
  runNativeUtility,
} from "../../zcode-cua/vendor/open-zcode-computer-use/src/host-client.mjs";

const desktop = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = createRequire(requireDesktop.resolve("tsup/package.json"))("esbuild");
const artifacts = await mkdtemp(join(tmpdir(), "zcode-cua-accessibility-"));
const entry = join(artifacts, "fixture.cjs");
const ready = join(artifacts, "ready.json");
const outcome = join(artifacts, "outcome.json");
const html = `<title>CUA regression fixture</title>
  ${Array.from({ length: 16 }, (_, i) => `<section role="group" aria-label="Layer ${i}">`).join("")}
  <label>CUA test input<input aria-label="CUA test input" value="seed"></label>
  <button onclick="this.textContent='Pressed once'">CUA test button</button>
  <canvas width="240" height="120" aria-label="CUA canvas"></canvas>
  ${"</section>".repeat(16)}
  <script>
    const {ipcRenderer}=require('electron');let clicks=0, mutated=false;
    const input=document.querySelector('input'), canvas=document.querySelector('canvas');
    canvas.style.cssText='display:block;margin:30px;background:teal';
    function report(){ipcRenderer.send('outcome',{text:input.value,clicks,mutated})}
    ipcRenderer.on('mutate',()=>{document.querySelector('button').textContent='Changed after snapshot';mutated=true;report()});
    canvas.onmousedown=()=>{clicks++;report()};input.oninput=report;input.focus();report();
  </script>`;
await build({
  stdin: {
    resolveDir: desktop,
    sourcefile: "computer-use-fixture.ts",
    contents: `
      import {app,BrowserWindow,ipcMain} from 'electron';
      import {writeFile} from 'node:fs/promises';
      import {createInterface} from 'node:readline';
      import {enableDesktopAccessibility} from './src/main/desktopAccessibility.ts';
      app.setPath('userData',${JSON.stringify(join(artifacts, "profile"))});
      app.whenReady().then(async()=>{
        enableDesktopAccessibility(app);
        const win=new BrowserWindow({width:650,height:480,show:false,alwaysOnTop:true,webPreferences:{nodeIntegration:true,contextIsolation:false}});
        let persistence=Promise.resolve();
        ipcMain.on('outcome',(_,state)=>{persistence=persistence.then(()=>writeFile(${JSON.stringify(outcome)},JSON.stringify(state)))});
        await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(html)}));
        win.show();
        createInterface({input:process.stdin}).on('line',line=>{if(line==='mutate')win.webContents.send('mutate')});
        await writeFile(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));
      });
      app.on('window-all-closed',()=>app.quit());
    `,
  },
  outfile: entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["electron"],
});
const executable = resolve(
  process.argv[2] ??
    join(
      desktop,
      "../zcode-cua/vendor/open-zcode-computer-use/native/.build/debug/OpenZCodeNative",
    ),
);
const initialFront = await runNativeUtility("frontmost", [], { executable });
const child = spawn(requireDesktop("electron"), [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});
let diagnostics = "";
child.stderr.on("data", (chunk) => {
  diagnostics += chunk;
});
const exited = once(child, "exit");
const service = createOpenComputerUseService({
  createService: () => {
    const host = new HostClient({ executable });
    const call = host.call.bind(host);
    host.call = async (...args) => {
      const result = await call(...args);
      if (result.ok === false) console.error("Native refusal:", JSON.stringify(result));
      return result;
    };
    return {
      host,
      service: new ComputerUseService({
        host,
        nativeUtility: (command, args) => runNativeUtility(command, args, { executable }),
      }),
    };
  },
});
async function until(read, accepts, description) {
  const end = Date.now() + 10000;
  do {
    try {
      const value = await read();
      if (accepts(value)) return value;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await pause(100);
  } while (Date.now() < end);
  throw new Error(`${description}: ${diagnostics}`);
}
async function call(name, args) {
  const result = await service.callTool(name, args);
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result;
}
function payload(result, key) {
  for (const item of result.content ?? [])
    if (item.type === "text") {
      const value = JSON.parse(item.text);
      if (key in value) return value;
    }
  throw new Error(`Missing ${key}`);
}
const readOutcome = async () => JSON.parse(await readFile(outcome, "utf8"));
try {
  const { pid } = await until(
    async () => JSON.parse(await readFile(ready, "utf8")),
    Boolean,
    "fixture readiness",
  );
  if (initialFront.pid)
    await runNativeUtility("activate", [String(initialFront.pid)], { executable });
  const app_ref = { pid };
  const observe = async (include_screenshot = false) =>
    payload(
      await call("get_app_state", {
        app_ref,
        detail: "full",
        include_screenshot,
      }),
      "state_id",
    );
  let state = await until(
    observe,
    (s) => s.elements.some((e) => e.name === "CUA test input" && e.editable),
    "Electron renderer AX tree",
  );
  const input = state.elements.find((e) => e.name === "CUA test input" && e.editable);
  const cleared = payload(
    await call("set_value", {
      target: { type: "element", state_id: state.state_id, index: input.index },
      value: "",
    }),
    "action_receipt",
  );
  assert.equal(cleared.action_receipt.effect, "confirmed", "empty AX text must be confirmed");
  await until(readOutcome, (v) => v.text === "", "cleared renderer input");
  state = await observe();
  const clearedInput = state.elements.find((e) => e.name === "CUA test input" && e.editable);
  await call("set_value", {
    target: { type: "element", state_id: state.state_id, index: clearedInput.index },
    value: "中英文 CUA 123",
  });
  state = await observe();
  assert.equal(
    state.elements.find((e) => e.name === "CUA test input" && e.editable)?.value,
    "中英文 CUA 123",
  );
  const focusInput = state.elements.find((e) => e.name === "CUA test input" && e.editable);
  await call("left_click", {
    target: { type: "element", state_id: state.state_id, index: focusInput.index },
    strategy: "a11y",
  });
  state = await observe();
  const button = state.elements.find((e) => e.name === "CUA test button" && e.pressable);
  assert.ok(button);
  await call("left_click", {
    target: { type: "element", state_id: state.state_id, index: button.index },
    strategy: "a11y",
  });
  state = await observe(true);
  assert.ok(state.elements.some((e) => e.name === "Pressed once"));
  const canvas = state.elements.find((e) => e.name === "CUA canvas");
  assert.ok(canvas?.bounds);
  // 测试夹具的 AX 几何作为 oracle，明确测试无 AXPress 的画布原始事件路径。
  const imageScale = state.image_ref.width / state.window.bounds[2];
  const point = {
    type: "coordinate",
    x: Math.round((canvas.bounds[0] - state.window.bounds[0] + canvas.bounds[2] / 2) * imageScale),
    y: Math.round((canvas.bounds[1] - state.window.bounds[1] + canvas.bounds[3] / 2) * imageScale),
  };
  // 截图后真正改变窗口内容必须拒绝；深树保持不变时则应正常派发。
  child.stdin.write("mutate\n");
  await until(readOutcome, (v) => v.mutated, "fixture changed after snapshot");
  const changed = await service.callTool("left_click", { target: point, strategy: "event" });
  assert.equal(changed.isError, true);
  assert.equal(changed.structuredContent.action_receipt.action_sent, false);
  assert.ok(
    changed.content.some(
      (item) => item.type === "text" && item.text.includes("no longer matches the snapshot"),
    ),
  );
  assert.equal((await readOutcome()).clicks, 0);
  state = await observe(true);
  const clicked = payload(
    await call("left_click", { target: point, strategy: "event" }),
    "action_receipt",
  );
  assert.equal(clicked.action_receipt.action_sent, true);
  await until(readOutcome, (v) => v.clicks === 1, "one raw canvas click delivered");
  const replay = await service.callTool("left_click", { target: point, strategy: "event" });
  assert.equal(replay.isError, true, "consumed frame must refuse replay");
  assert.equal((await readOutcome()).clicks, 1);
  const afterBackgroundActions = await runNativeUtility("frontmost", [], { executable });
  assert.equal(
    afterBackgroundActions.pid,
    initialFront.pid,
    "background actions must not steal focus",
  );
  // 独立验证已明确激活的测试窗口键盘路径；不更改产品的 require-focus 规则。
  await call("open_application", { app: { pid }, activate: true });
  await until(
    async () => runNativeUtility("frontmost", [], { executable }),
    (v) => v.pid === pid,
    "fixture activation",
  );
  state = await observe();
  const keyboardInput = state.elements.find((e) => e.name === "CUA test input" && e.editable);
  await call("left_click", {
    target: { type: "element", state_id: state.state_id, index: keyboardInput.index },
    strategy: "a11y",
  });
  state = await observe();
  assert.ok(state.elements.some((e) => e.name === "CUA test input" && e.focused));
  assert.equal(
    (await runNativeUtility("frontmost", [], { executable })).pid,
    pid,
    "foreground semantic click must preserve activation",
  );
  await call("key", { app_ref: { ...app_ref, window_id: state.window.window_id }, text: "cmd+a" });
  await call("type", {
    app_ref: { ...app_ref, window_id: state.window.window_id },
    text: "keyboard测试",
  });
  await until(readOutcome, (v) => v.text === "keyboard测试", "keyboard input delivered");
  console.log(
    `PASS: Electron deep AX tree, empty-value receipt, Chinese text, shortcuts, semantic click, one raw canvas click, changed-window and stale-frame rejection. Artifacts: ${artifacts}`,
  );
} finally {
  const front = await runNativeUtility("frontmost", [], { executable });
  if (front.pid === child.pid && initialFront.pid) {
    await runNativeUtility("activate", [String(initialFront.pid)], { executable });
  }
  await service.close();
  if (child.exitCode === null) child.kill("SIGTERM");
  await exited;
}
