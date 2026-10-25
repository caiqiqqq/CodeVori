import assert from "node:assert/strict";
import test from "node:test";
import type {
  DeviceInspectionRequest,
  DeviceInspectionResult,
  DeviceBridgeConfiguration,
  DeviceBridgeWorkerState,
  DeviceBridgeErrorCode,
} from "@zcode/shared";
import { createDeviceBridgeController } from "../src/main/deviceBridgeController.js";
import type { DeviceBridgeCredentialStore } from "../src/main/deviceBridgeCredentials.js";

function fixture(
  removeDevice: (
    apiKey: string,
    nodeId: string,
    signal: AbortSignal,
  ) => Promise<void> = async () => {},
  initialConfiguration?: DeviceBridgeConfiguration,
  inspectMcp?: (
    endpoint: { url: string; token: string },
    input: DeviceInspectionRequest,
  ) => Promise<DeviceInspectionResult>,
  credentials?: DeviceBridgeCredentialStore,
) {
  let configuration: DeviceBridgeConfiguration = initialConfiguration ?? {
    binaryPath: "/synthetic/bridge",
    allowedNodes: [],
    networkingEnabled: false,
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
  let starts = 0;
  let onExit: (reason?: DeviceBridgeErrorCode) => void = () => {};
  let startError: Error | undefined;
  let holdStart: Promise<void> | undefined;
  let releaseStart: (() => void) | undefined;
  let holdConfiguration: Promise<void> | undefined;
  let releaseConfiguration: (() => void) | undefined;
  let configurationRead: (() => void) | undefined;
  let failCheck = false,
    failLogout = false;
  let failWrite = false;
  let statusGate: { arrived(): void; wait: Promise<void> } | undefined;
  let holdCheck: Promise<void> | undefined;
  let releaseCheck: (() => void) | undefined;
  const controller = createDeviceBridgeController({
    credentials,
    inspectMcp,
    readConfiguration: async () => {
      if (holdConfiguration) {
        configurationRead?.();
        await holdConfiguration;
      }
      return configuration;
    },
    writeConfiguration: async (value) => {
      if (failWrite) throw new Error("synthetic disk failure");
      configuration = value;
    },
    startSession: async (exit) => {
      starts++;
      onExit = exit;
      if (holdStart) await holdStart;
      if (startError) throw startError;
      return {
        request: async (method, fields) => {
          if (method === "status" && statusGate) {
            const gate = statusGate;
            statusGate = undefined;
            gate.arrived();
            await gate.wait;
          }
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
    removeDevice,
  });
  return {
    controller,
    writes,
    worker,
    holdStatus: () => {
      let release!: () => void;
      let arrived!: () => void;
      const entered = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      statusGate = {
        arrived,
        wait: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      return { entered, release };
    },
    configuration: () => configuration,
    failWrite: (value: boolean) => {
      failWrite = value;
    },
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
      return new Promise<void>((resolve) => {
        configurationRead = resolve;
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
    get starts() {
      return starts;
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

test("remove requires key and a fresh non-self inventory target; successful removal cleans grants/MCP despite stale inventory", async () => {
  const calls: string[] = [];
  const f = fixture(async (key, id) => {
    assert.equal(key, "synthetic-key");
    calls.push(id);
  });
  await f.controller.execute({ action: "start" });
  await assert.rejects(
    f.controller.execute({ action: "remove", nodeId: "windows" }),
    /management_required/,
  );
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic-key" });
  for (const id of ["mac", "absent"])
    await assert.rejects(f.controller.execute({ action: "remove", nodeId: id }), /invalid_device/);
  await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true });
  await f.controller.execute({ action: "connect", nodeId: "windows" });
  const state = await f.controller.execute({ action: "remove", nodeId: "windows" });
  assert.deepEqual(calls, ["windows"]);
  assert.equal(state.managementConfigured, true);
  assert.equal(JSON.stringify(state).includes("synthetic-key"), false);
  assert.deepEqual(f.configuration().allowedNodes, []);
  assert.equal(f.worker.peers[0]!.allowed, false);
  assert.equal(f.worker.peers[0]!.connected, false);
  assert.equal((f.writes.at(-1) as { action: string }).action, "delete");
  assert.deepEqual((await f.controller.read()).peers, []);
  for (const action of ["remove", "connect", "check", "authorize"] as const)
    await assert.rejects(
      f.controller.execute(
        action === "authorize"
          ? { action, nodeId: "windows", allowed: true }
          : { action, nodeId: "windows" },
      ),
    );
  assert.deepEqual(calls, ["windows"]);
  await f.controller.execute({ action: "stop" });
  await f.controller.execute({ action: "start" });
  assert.deepEqual((await f.controller.read()).peers, []);
});

test("permission failure preserves grants, connections and visible inventory", async () => {
  const f = fixture(async () => {
    throw new Error("device_bridge_management_forbidden");
  });
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic-key" });
  await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true });
  await f.controller.execute({ action: "connect", nodeId: "windows" });
  await assert.rejects(
    f.controller.execute({ action: "remove", nodeId: "windows" }),
    /management_forbidden/,
  );
  const state = await f.controller.read();
  assert.equal(state.peers[0]!.connected, true);
  assert.deepEqual(f.configuration().allowedNodes, ["windows"]);
});

test("remote success with local write failure stops networking and retries cleanup before restart", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic-key" });
  await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true });
  f.failWrite(true);
  await assert.rejects(
    f.controller.execute({ action: "remove", nodeId: "windows" }),
    /removal_cleanup_failed/,
  );
  assert.equal((await f.controller.read()).phase, "error");
  await assert.rejects(f.controller.execute({ action: "start" }));
  f.failWrite(false);
  await f.controller.execute({ action: "start" });
  assert.deepEqual(f.configuration().allowedNodes, []);
  assert.deepEqual((await f.controller.read()).peers, []);
});

test("stop cancels in-flight removal; logout/clear/dispose erase in-memory management key", async () => {
  for (const action of ["stop", "logout", "clear-management", "dispose"] as const) {
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => (started = resolve));
    const f = fixture(async (_key, _id, signal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("device_bridge_removal_unconfirmed")),
          { once: true },
        );
      });
    });
    await f.controller.execute({ action: "start" });
    await f.controller.execute({ action: "configure-management", apiKey: "synthetic-key" });
    const removing = f.controller.execute({ action: "remove", nodeId: "windows" });
    const rejected = assert.rejects(removing, /removal_unconfirmed/);
    await dispatched;
    const stopping =
      action === "dispose" ? f.controller.dispose() : f.controller.execute({ action });
    await rejected;
    await stopping;
    assert.equal((await f.controller.read()).managementConfigured, action === "stop");
  }
});

test("clearing credentials during inventory refresh prevents destructive dispatch", async () => {
  let deletes = 0;
  const f = fixture(async () => {
    deletes++;
  });
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic" });
  const gate = f.holdStatus();
  const removing = f.controller.execute({ action: "remove", nodeId: "windows" });
  const rejected = assert.rejects(removing, /management_required/);
  await gate.entered;
  const clearing = f.controller.execute({ action: "clear-management" });
  gate.release();
  await rejected;
  await clearing;
  assert.equal(deletes, 0);
});

test("queued credential configuration cannot revive a removal cancelled by logout", async () => {
  let deletes = 0;
  const f = fixture(async () => {
    deletes++;
  });
  await f.controller.execute({ action: "start" });
  const gate = f.holdStatus();
  const read = f.controller.read();
  await gate.entered;
  const configure = f.controller.execute({ action: "configure-management", apiKey: "synthetic" });
  const removing = f.controller.execute({ action: "remove", nodeId: "windows" });
  const rejected = assert.rejects(removing, /management_required/);
  const logout = f.controller.execute({ action: "logout" });
  gate.release();
  await read;
  await configure;
  await rejected;
  await logout;
  assert.equal(deletes, 0);
  assert.equal((await f.controller.read()).managementConfigured, false);
});

test("a successful response arriving after stop still commits the deletion and local cleanup", async () => {
  let arrive!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => (arrive = resolve));
  const pending = new Promise<void>((resolve) => (release = resolve));
  const f = fixture(async () => {
    arrive();
    await pending;
  });
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic" });
  await f.controller.execute({ action: "authorize", nodeId: "windows", allowed: true });
  await f.controller.execute({ action: "connect", nodeId: "windows" });
  const removing = f.controller.execute({ action: "remove", nodeId: "windows" });
  await entered;
  const stopped = f.controller.execute({ action: "stop" });
  release();
  await removing;
  await stopped;
  assert.deepEqual(f.configuration().allowedNodes, []);
  assert.equal((f.writes.at(-1) as { action: string }).action, "delete");
});

test("stop invalidates a queued removal even if an earlier queued start creates a new process", async () => {
  let deletes = 0;
  const f = fixture(async () => {
    deletes++;
  });
  await f.controller.execute({ action: "start" });
  await f.controller.execute({ action: "configure-management", apiKey: "synthetic" });
  const gate = f.holdStatus();
  const reading = f.controller.read();
  const readRejected = assert.rejects(reading, /process_closed/);
  await gate.entered;
  const starting = f.controller.execute({ action: "start" });
  const removing = f.controller.execute({ action: "remove", nodeId: "windows" });
  const rejected = assert.rejects(removing, /process_closed/);
  const stopped = f.controller.execute({ action: "stop" });
  gate.release();
  await readRejected;
  await starting;
  await rejected;
  await stopped;
  assert.equal(deletes, 0);
});

test("app restart restores the same saved node after explicit connect; disposal keeps the connection choice", async () => {
  const first = fixture();
  await first.controller.restore();
  assert.equal(first.starts, 0);
  await first.controller.execute({ action: "start" });
  assert.equal(first.configuration().networkingEnabled, true);
  await first.controller.dispose();
  assert.equal(first.configuration().networkingEnabled, true);
  const restarted = fixture(undefined, first.configuration());
  await restarted.controller.restore();
  await restarted.controller.restore();
  const state = await restarted.controller.read();
  assert.equal(restarted.starts, 1);
  assert.equal(state.backendState, "Running");
  assert.equal(state.canLogin, false);
  assert.equal(state.nodeId, "mac");
  await restarted.controller.execute({ action: "stop" });
  const stopped = fixture(undefined, restarted.configuration());
  await stopped.controller.restore();
  assert.equal(stopped.starts, 0);
});

test("logout disables restoration even when account service fails", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start" });
  f.failLogout();
  await assert.rejects(f.controller.execute({ action: "logout" }));
  assert.equal(f.configuration().networkingEnabled, false);
  const restart = fixture(undefined, f.configuration());
  await restart.controller.restore();
  assert.equal(restart.starts, 0);
});

test("stop invalidates a restoration still reading configuration", async () => {
  const f = fixture(undefined, {
    binaryPath: "/synthetic/bridge",
    allowedNodes: [],
    networkingEnabled: true,
  });
  const entered = f.holdConfiguration();
  const restoring = f.controller.restore();
  await entered;
  const stopped = f.controller.execute({ action: "stop" });
  f.releaseConfiguration();
  await restoring;
  await stopped;
  assert.equal(f.starts, 0);
  assert.equal(f.configuration().networkingEnabled, false);
});

test("failed restoration stays visible and does not retry on settings reads", async () => {
  const f = fixture(undefined, {
    binaryPath: "/synthetic/bridge",
    allowedNodes: [],
    networkingEnabled: true,
  });
  f.setStartError("device_bridge_component_missing");
  await assert.rejects(f.controller.restore());
  assert.equal((await f.controller.read()).error, "device_bridge_component_missing");
  await f.controller.read();
  assert.equal(f.starts, 1);
  assert.equal(f.configuration().networkingEnabled, true);
});

test("restored nodes still report expired authorization from the native backend", async () => {
  const f = fixture(undefined, {
    binaryPath: "/synthetic/bridge",
    allowedNodes: [],
    networkingEnabled: true,
  });
  f.worker.backendState = "NeedsLogin";
  f.worker.authUrl = "https://login.tailscale.com/a/synthetic";
  f.worker.loginName = "";
  f.worker.peers = [];
  await f.controller.restore();
  const state = await f.controller.read();
  assert.equal(state.backendState, "NeedsLogin");
  assert.equal(state.canLogin, true);
  assert.equal(state.loginName, "");
});

test("inspection requires a checked connection, rejects duplicate reads and invalidates late results on disconnect or stop", async () => {
  for (const action of ["disconnect", "stop"] as const) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result: DeviceInspectionResult = {
      kind: "screen",
      nodeId: "windows",
      sampledAt: "2026-10-25T00:00:00Z",
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
    };
    let calls = 0;
    const f = fixture(undefined, undefined, async () => {
      calls++;
      await gate;
      return result;
    });
    await assert.rejects(f.controller.inspect({ nodeId: "windows", kind: "screen" }));
    await f.controller.execute({ action: "start" });
    await assert.rejects(f.controller.inspect({ nodeId: "windows", kind: "screen" }));
    await f.controller.execute({ action: "connect", nodeId: "windows" });
    const pending = f.controller.inspect({ nodeId: "windows", kind: "screen" });
    await assert.rejects(f.controller.inspect({ nodeId: "windows", kind: "screen" }));
    assert.equal(calls, 1);
    await f.controller.execute(
      action === "stop" ? { action: "stop" } : { action: "disconnect", nodeId: "windows" },
    );
    release();
    await assert.rejects(pending);
    await f.controller.dispose();
  }
});

test("remembered management key survives app disposal, isolates accounts and clears on logout", async () => {
  let saved: { scope: string; key: string } | undefined;
  let failClear = false;
  const store: DeviceBridgeCredentialStore = {
    read: async (scope) => (saved?.scope === scope ? saved.key : undefined),
    save: async (scope, key) => {
      saved = { scope, key };
    },
    clear: async () => {
      if (failClear) throw Error("synthetic-private-storage-error");
      saved = undefined;
    },
  };
  const first = fixture(undefined, undefined, undefined, store);
  await first.controller.execute({ action: "start" });
  await first.controller.execute({ action: "configure-management", apiKey: "synthetic-saved-key" });
  assert.ok(saved);
  assert.equal(
    JSON.stringify(await first.controller.read()).includes("synthetic-saved-key"),
    false,
  );
  await first.controller.dispose();
  assert.ok(saved);
  const next = fixture(undefined, first.configuration(), undefined, store);
  await next.controller.restore();
  assert.equal((await next.controller.read()).managementConfigured, true);
  next.worker.loginName = "other@test.invalid";
  assert.equal((await next.controller.read()).managementConfigured, false);
  next.worker.loginName = "synthetic@example.test";
  assert.equal((await next.controller.read()).managementConfigured, true);
  await next.controller.execute({ action: "clear-management" });
  assert.equal(saved, undefined);
  await next.controller.execute({ action: "configure-management", apiKey: "synthetic-saved-key" });
  await next.controller.execute({ action: "logout" });
  assert.equal(saved, undefined);
  await next.controller.execute({ action: "start" });
  await next.controller.execute({ action: "configure-management", apiKey: "synthetic-saved-key" });
  failClear = true;
  await assert.rejects(
    next.controller.execute({ action: "logout" }),
    /management_storage_unavailable/,
  );
  assert.equal(next.configuration().networkingEnabled, false);
  assert.equal((await next.controller.read()).phase, "stopped");
  assert.equal((await next.controller.read()).managementConfigured, false);
});

test("clear during persisted-key restoration cannot republish the saved credential", async () => {
  let entered!: () => void, release!: (value: string) => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let stored = "synthetic-saved";
  const store: DeviceBridgeCredentialStore = {
    read: () => {
      entered();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
    save: async (_scope, key) => {
      stored = key;
    },
    clear: async () => {
      stored = "";
    },
  };
  const f = fixture(undefined, undefined, undefined, store);
  const start = f.controller.execute({ action: "start" });
  await reading;
  const clear = f.controller.execute({ action: "clear-management" });
  release("synthetic-saved");
  await start;
  await clear;
  assert.equal(stored, "");
  assert.equal((await f.controller.read()).managementConfigured, false);
});
