import assert from "node:assert/strict";
import test from "node:test";
import { waitForRecoveredAuthority } from "../src/v4/staleAuthorityRecovery.js";

function createAuthorityStore() {
  const original = { revision: 5, logEpoch: "epoch-a" };
  let state: { status: string; snapshot: typeof original | null; authorityVersion: number } = {
    status: "live",
    snapshot: original,
    authorityVersion: 1,
  };
  const listeners = new Set<() => void>();
  let recoveries = 0;
  return {
    original,
    get recoveries() {
      return recoveries;
    },
    get listeners() {
      return listeners.size;
    },
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recoverFromStaleAuthority() {
      recoveries += 1;
    },
    publish(next: typeof state) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

test("只在新权威快照到达后结束等待，并清理订阅", async () => {
  const store = createAuthorityStore();
  const pending = waitForRecoveredAuthority(store);
  assert.equal(store.recoveries, 1);
  assert.equal(store.listeners, 1);
  store.publish({ status: "live", snapshot: store.original, authorityVersion: 1 });
  assert.equal(store.listeners, 1);
  const recovered = { revision: 6, logEpoch: "epoch-a" };
  store.publish({ status: "live", snapshot: recovered, authorityVersion: 2 });
  assert.equal(await pending, recovered);
  assert.equal(store.listeners, 0);
});

test("连接关闭时结束等待，不留下订阅", async () => {
  const store = createAuthorityStore();
  const pending = waitForRecoveredAuthority(store);
  store.publish({ status: "closed", snapshot: store.original, authorityVersion: 1 });
  await assert.rejects(pending, /recovery closed/);
  assert.equal(store.listeners, 0);
});

test("恢复同步报错时清理监听并保留原因", async () => {
  const store = createAuthorityStore();
  const error = new Error("connection unavailable");
  store.recoverFromStaleAuthority = () => {
    throw error;
  };
  await assert.rejects(waitForRecoveredAuthority(store), error);
  assert.equal(store.listeners, 0);
});
