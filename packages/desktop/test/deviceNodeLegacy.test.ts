import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { retireDeviceNodeRelay } from "../src/main/deviceNodeLegacy.js";

test("retire relay entries without network requests or touching existing tailnet MCPs", async () => {
  const id = "a".repeat(43),
    name = `device-node-${createHash("sha256").update(id).digest("hex").slice(0, 20)}`;
  const servers = new Set([name, "device-bridge-123", "user-server"]);
  let saved: unknown = { records: [{ id, token: "private" }] };
  const ports = {
    read: async () => saved,
    removeMcp: async (name: string) => {
      servers.delete(name);
    },
    removeBindings: async () => {
      saved = undefined;
    },
  };
  await retireDeviceNodeRelay(ports);
  await retireDeviceNodeRelay(ports);
  assert.deepEqual([...servers], ["device-bridge-123", "user-server"]);
  assert.equal(saved, undefined);
});

test("failed cleanup retains bindings for retry; corrupt bindings cannot delete arbitrary MCPs", async () => {
  let deleted = false,
    removed = false;
  await assert.rejects(
    retireDeviceNodeRelay({
      read: async () => ({ records: [{ id: "a".repeat(43) }] }),
      removeMcp: async () => {
        throw Error("disk");
      },
      removeBindings: async () => {
        removed = true;
      },
    }),
  );
  assert.equal(removed, false);
  await assert.rejects(
    retireDeviceNodeRelay({
      read: async () => ({ records: [{ id: "user-server" }] }),
      removeMcp: async () => {
        deleted = true;
      },
      removeBindings: async () => {
        removed = true;
      },
    }),
  );
  assert.equal(deleted, false);
  assert.equal(removed, false);
});
