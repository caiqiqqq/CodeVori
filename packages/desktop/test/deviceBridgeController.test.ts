import assert from "node:assert/strict";
import test from "node:test";
import type {
  DeviceBridgeConfiguration,
  DeviceBridgeWorkerState,
  DeviceBridgeErrorCode,
} from "@zcode/shared";
import { createDeviceBridgeController } from "../src/main/deviceBridgeController.js";

function fixture() {
  let configuration: DeviceBridgeConfiguration = {
    binaryPath: "/synthetic/bridge",
    allowedNodes: [],
  };
  const worker: DeviceBridgeWorkerState = {
    backendState: "Running",
    nodeId: "mac",
    dnsName: "mac.example.ts.net",
    loginName: "synthetic@example.test",
    tailnet: "example",
    exposing: false,
    peers: [
      {
        nodeId: "windows",
        name: "Windows",
        os: "windows",
        online: true,
        connected: false,
        allowed: false,
      },
    ],
  };
  const writes: unknown[] = [];
  let exits = 0;
  let onExit: (reason?: DeviceBridgeErrorCode) => void = () => {};
  let startError: Error | undefined;
  let holdStart: Promise<void> | undefined;
  let releaseStart: (() => void) | undefined;
  let holdConfiguration: Promise<void> | undefined;
  let releaseConfiguration: (() => void) | undefined;
  let failCheck = false,
    failLogout = false;
  let holdCheck: Promise<void> | undefined;
  let releaseCheck: (() => void) | undefined;
  const controller = createDeviceBridgeController({
    readConfiguration: async () => {
      if (holdConfiguration) await holdConfiguration;
      return configuration;
    },
    writeConfiguration: async (value) => {
      configuration = value;
    },
    startSession: async (exit) => {
      onExit = exit;
      if (holdStart) await holdStart;
      if (startError) throw startError;
      return {
        request: async (method, fields) => {
          if (method === "logout" && failLogout) throw new Error("logout failed");
          if (method === "connect") {
            worker.peers[0]!.connected = true;
            return {
              version: 1,
              id: "1",
              state: structuredClone(worker),
              connection: {
                nodeId: "windows",
                url: "http://127.0.0.1:18743/mcp",
                token: "synthetic-credential-".repeat(3),
              },
            };
          }
          if (method === "disconnect") worker.peers[0]!.connected = false;
          if (method === "expose") {
            worker.peers[0]!.allowed = ((fields?.allowedNodes ?? []) as string[]).includes(
              "windows",
            );
            worker.exposing = worker.peers[0]!.allowed;
          }
          return { version: 1, id: "1", state: structuredClone(worker) };
        },
        stop: async () => {
          exits++;
          onExit();
        },
      };
    },
    saveMcp: async (request) => {
      writes.push(request);
    },
    checkMcp: async () => {
      if (holdCheck) await holdCheck;
      if (failCheck) throw new Error("unavailable");
      return 7;
    },
    openLogin: async () => {},
  });
  return {
    controller,
    writes,
    worker,
    setStartError: (code?: string) => {
      startError = code ? new Error(code) : undefined;
    },
    holdStart: () => {
      holdStart = new Promise((resolve) => {
        releaseStart = resolve;
      });
    },
    releaseStart: () => releaseStart?.(),
    holdConfiguration: () => {
      holdConfiguration = new Promise((resolve) => {
        releaseConfiguration = resolve;
      });
    },
    releaseConfiguration: () => releaseConfiguration?.(),
    failLogout: () => {
      failLogout = true;
    },
    exit: () => onExit(),
    failCheck: () => {
      failCheck = true;
    },
    holdCheck: () => {
      holdCheck = new Promise((resolve) => {
        releaseCheck = resolve;
      });
    },
    releaseCheck: () => releaseCheck?.(),
    get exits() {
      return exits;
    },
  };
}

test("failed account logout still closes listeners and removes published tools", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "connect", nodeId: "windows" });
  f.failLogout();
  await assert.rejects(f.controller.execute({ action: "logout" }));
  assert.equal((await f.controller.read()).phase, "stopped");
  assert.equal(f.exits, 1);
  assert.equal((f.writes.at(-1) as { action: string }).action, "delete");
});

test("startup errors survive reads and clear after a successful retry or configure", async () => {
  const f = fixture();
  for (const code of [
    "device_bridge_component_missing",
    "device_bridge_component_not_executable",
    "device_bridge_start_failed",
  ]) {
    f.setStartError(code);
    await assert.rejects(f.controller.execute({ action: "start" }), { message: code });
    const failed = await f.controller.read();
    assert.equal(failed.phase, "error");
    assert.equal(failed.error, code);
    assert.equal(failed.peers.length, 0);
    assert.equal(
      (await f.controller.execute({ action: "configure", binaryPath: "/synthetic/retry" })).error,
      undefined,
    );
  }
  f.setStartError();
  assert.equal((await f.controller.execute({ action: "start" })).error, undefined);
});

test("stop during async component preparation closes the late session", async () => {
  const f = fixture();
  f.holdStart();
  const starting = f.controller.execute({ action: "start" });
  const rejected = assert.rejects(starting, /device_bridge_process_closed/);
  await new Promise((resolve) => setImmediate(resolve));
  const stopped = f.controller.execute({ action: "stop" });
  f.releaseStart();
  await rejected;
  assert.equal((await stopped).phase, "stopped");
  assert.equal(f.exits, 1);
});

test("stop while reading configuration cancels startup before spawning", async () => {
  const f = fixture();
  f.holdConfiguration();
  const rejected = assert.rejects(
    f.controller.execute({ action: "start" }),
    /device_bridge_process_closed/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const stopped = f.controller.execute({ action: "stop" });
  f.releaseConfiguration();
  await rejected;
  assert.equal((await stopped).phase, "stopped");
  assert.equal(f.exits, 0);
});

test("reading settings does not start a network node; connect checks MCP before publication", async () => {
  const f = fixture();
  assert.equal((await f.controller.read()).phase, "stopped");
  assert.equal(
    (await f.controller.execute({ action: "start" })).loginName,
    "synthetic@example.test",
  );
  const connected = await f.controller.execute({ action: "connect", nodeId: "windows" });
  assert.equal(connected.peers[0]?.toolCount, 7);
  assert.equal(JSON.stringify(connected).includes("synthetic-credential"), false);
  assert.equal(f.writes.length, 1);
  await f.controller.execute({ action: "disconnect", nodeId: "windows" });
  assert.equal((f.writes[1] as { action: string }).action, "delete");
  await f.controller.execute({ action: "stop" });
  assert.equal(f.exits, 1);
});

test("failed MCP check rolls back listener and does not publish a usable device", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  f.failCheck();
  await assert.rejects(f.controller.execute({ action: "connect", nodeId: "windows" }));
  assert.equal(f.writes.length, 0);
  assert.equal((await f.controller.read()).peers[0]?.connected, false);
});

test("authorization is explicit and process exit invalidates runtime projection", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  assert.equal((await f.controller.read()).exposing, false);
  assert.equal(
    (await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true }))
      .exposing,
    true,
  );
  assert.equal(
    (await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: false }))
      .exposing,
    false,
  );
  f.exit();
  assert.equal((await f.controller.read()).phase, "error");
  await assert.rejects(f.controller.execute({ action: "connect", nodeId: "windows" }));
});

test("saved grants are restored again after a bridge crash and restart", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true });
  f.exit();
  f.worker.peers[0]!.allowed = false;
  f.worker.exposing = false;
  assert.equal((await f.controller.execute({ action: "start" })).exposing, true);
});

test("stop invalidates an in-flight health check before it can publish MCP configuration", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  f.holdCheck();
  const connecting = f.controller.execute({ action: "connect", nodeId: "windows" });
  const rejected = assert.rejects(connecting, /process_closed/);
  await new Promise((resolve) => setImmediate(resolve));
  const stopped = f.controller.execute({ action: "stop" });
  f.releaseCheck();
  await rejected;
  assert.equal((await stopped).phase, "stopped");
  assert.equal(f.writes.length, 0);
});
