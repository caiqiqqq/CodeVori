import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startDeviceBridgeProcess } from "../src/main/deviceBridgeProcess.js";

// 用隔离的真实子进程检验 stdio 生命周期，不注册任何真实网络节点。
async function fakeBinary(source: string, run: (binaryPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "device-bridge-process-"));
  const file = join(directory, "bridge");
  try {
    await writeFile(file, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    await run(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  "bridge protocol rejects pending requests on malformed stdout without leaking output",
  { skip: process.platform === "win32" },
  async () => {
    await fakeBinary(
      `process.stdin.once('data',()=>{process.stdout.write('synthetic-private-output\\n')});`,
      async (binaryPath) => {
        let exits = 0;
        const session = startDeviceBridgeProcess({
          binaryPath,
          stateDir: "/synthetic",
          hostname: "synthetic",
          onExit: () => {
            exits++;
          },
        });
        await assert.rejects(session.request("status"), {
          message: "device_bridge_process_closed",
        });
        await assert.rejects(session.request("status"), {
          message: "device_bridge_process_closed",
        });
        await session.stop();
        assert.equal(exits, 1);
      },
    );
  },
);

test(
  "stopping a bridge closes stdin and rejects pending requests",
  { skip: process.platform === "win32" },
  async () => {
    await fakeBinary(
      `process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`,
      async (binaryPath) => {
        let exits = 0;
        const session = startDeviceBridgeProcess({
          binaryPath,
          stateDir: "/synthetic",
          hostname: "synthetic",
          onExit: () => {
            exits++;
          },
        });
        const waiting = assert.rejects(session.request("status"), /device_bridge_process_closed/);
        await session.stop();
        await waiting;
        assert.equal(exits, 1);
      },
    );
  },
);
