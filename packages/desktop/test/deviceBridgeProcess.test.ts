import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
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
        const session = await startDeviceBridgeProcess({
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
        const session = await startDeviceBridgeProcess({
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

test("bridge preflight rejects missing files and directories with safe errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bridge-preflight-"));
  try {
    for (const binaryPath of [join(directory, "missing"), directory]) {
      await assert.rejects(
        startDeviceBridgeProcess({
          binaryPath,
          stateDir: directory,
          hostname: "test",
          onExit() {},
        }),
        { message: "device_bridge_component_missing" },
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "bridge reports permission and launch failures without raw OS output",
  {
    skip: process.platform === "win32",
  },
  async () => {
    await fakeBinary("process.exit(1)", async (binaryPath) => {
      await chmod(binaryPath, 0o600);
      await assert.rejects(
        startDeviceBridgeProcess({
          binaryPath,
          stateDir: "/synthetic",
          hostname: "test",
          onExit() {},
        }),
        { message: "device_bridge_component_not_executable" },
      );
      await chmod(binaryPath, 0o700);
      const reasons: string[] = [];
      const session = await startDeviceBridgeProcess({
        binaryPath,
        stateDir: "/synthetic",
        hostname: "test",
        onExit: (reason) => reasons.push(reason),
      });
      await assert.rejects(session.request("status"), { message: "device_bridge_start_failed" });
      await assert.rejects(session.request("status"), { message: "device_bridge_start_failed" });
      assert.deepEqual(reasons, ["device_bridge_start_failed"]);
      await session.stop();
    });
  },
);

test(
  "a bridge that exits after a valid response is a runtime failure",
  { skip: process.platform === "win32" },
  async () => {
    await fakeBinary(
      `process.stdin.once('data', data => {
    process.stdout.write(JSON.stringify({version:1,id:JSON.parse(data).id})+'\\n',()=>process.exit(1));
  });`,
      async (binaryPath) => {
        let exited!: () => void;
        const exit = new Promise<void>((resolve) => {
          exited = resolve;
        });
        const session = await startDeviceBridgeProcess({
          binaryPath,
          stateDir: "/synthetic",
          hostname: "test",
          onExit: exited,
        });
        await session.request("status");
        await exit;
        await assert.rejects(session.request("status"), {
          message: "device_bridge_process_closed",
        });
        await session.stop();
      },
    );
  },
);
