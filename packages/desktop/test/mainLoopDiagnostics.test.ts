import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { startMainLoopDiagnostics } from "../src/main/mainLoopDiagnostics.js";

test("main observation removes its monitor on stop and does not add a swallowing exception handler", () => {
  const monitorCount = process.listenerCount("uncaughtExceptionMonitor");
  const handlerCount = process.listenerCount("uncaughtException");
  const stop = startMainLoopDiagnostics({ warn() {} });
  assert.equal(process.listenerCount("uncaughtExceptionMonitor"), monitorCount + 1);
  assert.equal(process.listenerCount("uncaughtException"), handlerCount);
  stop();
  stop();
  assert.equal(process.listenerCount("uncaughtExceptionMonitor"), monitorCount);
});

test("an actual uncaught exception still exits the child with failure and only fixed diagnostics are emitted", async () => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {startMainLoopDiagnostics} from './packages/desktop/src/main/mainLoopDiagnostics.ts';
    startMainLoopDiagnostics({warn:(_marker,record)=>process.stdout.write(JSON.stringify(record)+'\\n')});
    setImmediate(()=>{throw new Error('Maximum update depth exceeded token=private-fixture')});
  `,
    ],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.resume();
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 1);
  const diagnostic = JSON.parse(stdout.trim());
  assert.equal(diagnostic.operation, "main.uncaught-exception");
  assert.equal(diagnostic.error.cause, "maximum-update-depth");
  assert.equal(stdout.includes("private-fixture"), false);
});
