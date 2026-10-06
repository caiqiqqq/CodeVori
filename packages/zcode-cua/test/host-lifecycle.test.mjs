import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { HostClient } from "../vendor/open-zcode-computer-use/src/host-client.mjs";

test(
  "spawn rejection cleans temporary images without waiting for a nonexistent exit",
  { skip: process.platform === "win32", timeout: 2000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-native-launch-test-"));
    const executable = join(root, "not-executable");
    await writeFile(executable, "not an executable", { mode: 0o600 });
    const host = new HostClient({ executable });
    try {
      await assert.rejects(host.start());
      await host.close();
      assert.equal(host.accepting, false);
      assert.equal(host.closed, true);
      await assert.rejects(access(host.imageDir), { code: "ENOENT" });
    } finally {
      await host.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("native timeout fences input and waits for executor exit before reporting failure", async () => {
  const host = new HostClient({ requestTimeoutMs: 10 });
  const child = new EventEmitter();
  let terminated;
  const termination = new Promise((resolve) => {
    terminated = resolve;
  });
  Object.assign(child, {
    pid: 123,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    kill: (signal) => {
      assert.equal(signal, "SIGTERM");
      terminated();
      return true;
    },
  });
  host.child = child;
  let settled = false;
  const operation = host.call("input.dispatch", { pid: 42 }).catch((error) => {
    settled = true;
    return error;
  });
  await termination;
  assert.equal(host.accepting, false);
  assert.equal(settled, false);
  child.signalCode = "SIGTERM";
  child.emit("exit", null, "SIGTERM");
  const error = await operation;
  assert.equal(error.delivery, "possibly_sent");
  await assert.rejects(host.call("input.dispatch"), /not running/);
  await host.close();
  child.stdin.destroy();
});
