import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceNodeConnections } from "../src/main/deviceNodeConnections.js";

test("automatic enrollment publishes only checked tools, persists intent and revokes", async () => {
  let records: unknown[] = [];
  let status = "waiting";
  const writes: any[] = [];
  const id = "a".repeat(43),
    token = "b".repeat(43);
  const manager = createDeviceNodeConnections({
    serviceUrl: "http://127.0.0.1:18081",
    name: "Controller",
    readRecords: async () => records,
    writeRecords: async (value) => {
      records = structuredClone(value);
    },
    request: async (_url, method) =>
      method === "POST"
        ? {
            id,
            controllerToken: token,
            invitation: "c".repeat(43),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }
        : method === "GET"
          ? { id, status, connectionId: "generation-1" }
          : {},
    checkMcp: async () => 7,
    saveMcp: async (value) => {
      writes.push(value);
    },
  });
  await manager.execute({ action: "node-create", platform: "win32-x64" });
  assert.equal((await manager.read())[0]?.status, "waiting");
  assert.equal(writes.filter((v) => v.action === "upsert").length, 0);
  status = "online";
  await manager.refresh();
  const view = (await manager.read())[0]!;
  assert.equal(view.status, "ready");
  assert.equal(view.toolCount, 7);
  assert.equal(JSON.stringify(view).includes(token), false);
  assert.equal(writes.at(-1).action, "upsert");
  await manager.execute({ action: "node-enable", id, enabled: false });
  await manager.refresh();
  assert.equal((await manager.read())[0]?.status, "disabled");
  assert.equal(writes.at(-1).action, "delete");
  await manager.execute({ action: "node-remove", id });
  assert.deepEqual(await manager.read(), []);
  await manager.dispose();
});

test("a failed handshake never publishes a connection, disposal blocks late check", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: any[] = [];
  let checking!: () => void;
  const arrived = new Promise<void>((resolve) => {
    checking = resolve;
  });
  const manager = createDeviceNodeConnections({
    serviceUrl: "https://example.test/device-node",
    name: "Controller",
    readRecords: async () => [
      {
        id: "a".repeat(43),
        token: "b".repeat(43),
        platform: "linux-x64",
        enabled: true,
        expiresAt: "2030-01-01T00:00:00Z",
      },
    ],
    writeRecords: async () => {},
    request: async () => ({ status: "online", connectionId: "one" }),
    checkMcp: async () => {
      checking();
      await gate;
      return 2;
    },
    saveMcp: async (value) => {
      writes.push(value);
    },
  });
  const refresh = manager.refresh();
  await arrived;
  const dispose = manager.dispose();
  release();
  await refresh;
  await dispose;
  assert.equal(writes.filter((v) => v.action === "upsert").length, 0);
});

test("a failed MCP check and a disabled persisted binding never publish tools", async () => {
  const writes: any[] = [];
  const manager = createDeviceNodeConnections({
    serviceUrl: "https://example.test/device-node",
    name: "Controller",
    readRecords: async () =>
      [true, false].map((enabled, i) => ({
        id: String(i).repeat(43),
        token: "b".repeat(43),
        platform: "linux-x64",
        enabled,
        expiresAt: "2030-01-01T00:00:00Z",
      })),
    writeRecords: async () => {},
    request: async () => ({ status: "online", connectionId: "one" }),
    checkMcp: async () => {
      throw new Error("synthetic handshake failure");
    },
    saveMcp: async (v) => {
      writes.push(v);
    },
  });
  await manager.refresh();
  assert.deepEqual(
    (await manager.read()).map((r) => r.status),
    ["error", "disabled"],
  );
  assert.equal(
    writes.some((v) => v.action === "upsert"),
    false,
  );
  await manager.dispose();
});
