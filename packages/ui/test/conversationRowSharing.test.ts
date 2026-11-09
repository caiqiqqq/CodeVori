import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialConversationSnapshot,
  type ConversationDelta,
  type ConversationRow,
  type ConversationTopicFrame,
  type TopicFrameDeliveryKind,
} from "@zcode/shared/zcode-protocol-v4";
import { ConversationProjectionStore } from "../src/v4/conversationProjectionStore.js";
import { SessionDataLayer } from "../src/v4/sessionDataLayer.js";
import { waitForRecoveredAuthority } from "../src/v4/staleAuthorityRecovery.js";
import type { ConversationProjectionTransport } from "../src/v4/transport.js";

(
  globalThis as typeof globalThis & { __ZCODE_RENDERER_DISABLE_LOGGING__: boolean }
).__ZCODE_RENDERER_DISABLE_LOGGING__ = true;

function textRow(rowId: number, text = "answer"): ConversationRow {
  return {
    kind: "assistantText",
    rowId,
    turnId: `turn-${rowId}`,
    createdAt: 1,
    createdAtSeq: 1,
    state: "streaming",
    text,
  };
}

function userRow(rowId: number): ConversationRow {
  return {
    kind: "userInput",
    rowId,
    turnId: `turn-${rowId}`,
    createdAt: 1,
    createdAtSeq: 1,
    text: `question-${rowId}`,
    origin: "realUser",
  };
}

function fixture() {
  let seq = 1;
  let subscription = 0;
  let activeSubscription = "";
  let topic = "conversation/session";
  let epoch = "epoch";
  let rows = [userRow(1), textRow(2), userRow(3), textRow(4)];
  let tail = 2;
  const listeners = new Set<Parameters<ConversationProjectionTransport["onFrame"]>[0]>();
  const emit = (frame: ConversationTopicFrame, deliveryKind: TopicFrameDeliveryKind) => {
    for (const listener of listeners) listener(frame, { deliveryKind });
  };
  const snapshot = (deliveryKind: TopicFrameDeliveryKind = "online") => {
    const snapshot = createInitialConversationSnapshot("session", epoch);
    snapshot.seq = seq;
    snapshot.revision = seq;
    snapshot.rows = {
      window: structuredClone(rows.slice(-tail)),
      totalCount: rows.length,
      firstRowId: rows[0]?.rowId ?? null,
    };
    emit(
      {
        topic,
        subscriptionId: activeSubscription,
        fromSeq: 0,
        toSeq: seq,
        sentAt: 1,
        payload: { kind: "snapshot", snapshot },
      },
      deliveryKind,
    );
  };
  const transport: ConversationProjectionTransport = {
    subscribe: async (params) => {
      topic = params.topic;
      activeSubscription = `sub-${++subscription}`;
      return { ack: { subscriptionId: activeSubscription, mode: "snapshot", logEpoch: epoch } };
    },
    activate: () => snapshot("initial"),
    unsubscribe: async () => {},
    resync: async () => {
      snapshot("recovery");
      return { ack: { subscriptionId: activeSubscription, mode: "snapshot", logEpoch: epoch } };
    },
    rowsRange: async ({ beforeRowId, limit }) => {
      const candidates = rows.filter((row) => beforeRowId === undefined || row.rowId < beforeRowId);
      return {
        rows: structuredClone(candidates.slice(-limit)),
        atSeq: seq,
        atRevision: seq,
        atLogEpoch: epoch,
        hasMore: candidates.length > limit,
      };
    },
    plans: async () => ({ plans: [], atSeq: seq, atLogEpoch: epoch }),
    onFrame: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onAssemblyFault: () => () => {},
    onRuntimeRestart: () => () => {},
  };
  return {
    transport,
    snapshot,
    setRows(value: ConversationRow[], newTail = value.length) {
      rows = value;
      tail = newTail;
    },
    setEpoch(value: string) {
      epoch = value;
    },
    alignedRecovery() {
      emit(
        {
          topic,
          subscriptionId: activeSubscription,
          fromSeq: seq,
          toSeq: seq,
          sentAt: 1,
          payload: { kind: "deltas", deltas: [] },
        },
        "recovery",
      );
    },
    delta(deltas: ConversationDelta[], deliveryKind: TopicFrameDeliveryKind = "online") {
      const fromSeq = seq++;
      emit(
        {
          topic,
          subscriptionId: activeSubscription,
          fromSeq,
          toSeq: seq,
          sentAt: 1,
          payload: { kind: "deltas", deltas },
        },
        deliveryKind,
      );
    },
    async open() {
      const store = new ConversationProjectionStore("conversation/session", transport);
      const off = transport.onFrame((frame, context) => store.handleFrame(frame, context));
      await store.connect();
      return {
        store,
        async close() {
          off();
          await store.close();
        },
      };
    },
  };
}

test("stale detail waits for the real same-sub recovery snapshot across an epoch change", async () => {
  const f = fixture();
  const { store, close } = await f.open();
  try {
    const original = store.getState().snapshot!;
    const subscription = store.getState().subscriptionId;
    f.setEpoch("recovered-epoch");
    const recovered = await waitForRecoveredAuthority(store);
    assert.equal(recovered.logEpoch, "recovered-epoch");
    assert.notEqual(recovered, original);
    assert.equal(store.getState().subscriptionId, subscription);
    assert.equal(store.getState().status, "live");
  } finally {
    await close();
  }
});

test("history pagination cannot end the artifact authority recovery wait", async () => {
  const f = fixture();
  const { store, close } = await f.open();
  const resync = f.transport.resync;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.transport.resync = async (params) => {
    await gate;
    return resync(params);
  };
  let settled = false;
  const pending = waitForRecoveredAuthority(store).then((snapshot) => {
    settled = true;
    return snapshot;
  });
  try {
    await store.loadOlder();
    assert.equal(store.getState().snapshot!.rows.window.length, 4);
    assert.equal(settled, false, "local history rows are not a recovered authority");
    f.setEpoch("recovered-epoch");
    release();
    assert.equal((await pending).logEpoch, "recovered-epoch");
  } finally {
    release();
    await close();
    await pending.catch(() => {});
  }
});

test("aligned recovery ends the artifact wait without replacing the snapshot", async () => {
  const f = fixture();
  const { store, close } = await f.open();
  const original = store.getState().snapshot!;
  f.transport.resync = async ({ subscriptionId }) => {
    f.alignedRecovery();
    return { ack: { subscriptionId, mode: "resume", logEpoch: original.logEpoch } };
  };
  try {
    assert.equal(await waitForRecoveredAuthority(store), original);
  } finally {
    await close();
  }
});

for (const delivery of ["online", "recovery"] as const) {
  test(`${delivery}: equal snapshots/upserts share rows, streamed text updates keep old snapshots intact`, async () => {
    const f = fixture();
    const { store, close } = await f.open();
    try {
      const original = store.getState().snapshot!;
      f.snapshot(delivery);
      assert.equal(store.getState().snapshot!.rows.window, original.rows.window);
      const row = original.rows.window[1]!;
      f.delta([{ op: "row.upserted", row: structuredClone(row) }], delivery);
      assert.equal(store.getState().snapshot!.rows.window[1], row);
      f.delta([{ op: "row.delta", rowId: row.rowId, path: "text", append: " more" }], delivery);
      const streamed = store.getState().snapshot!.rows.window[1]!;
      assert.notEqual(streamed, row);
      assert.equal(streamed.kind === "assistantText" && streamed.text, "answer more");
      assert.equal(row.kind === "assistantText" && row.text, "answer");
      f.delta([{ op: "row.upserted", row: structuredClone(streamed) }], delivery);
      assert.equal(store.getState().snapshot!.rows.window[1], streamed);
    } finally {
      await close();
    }
  });
}

for (const method of ["loadOlder", "loadAllOlder"] as const) {
  test(`${method}: refreshed tail does not keep old membership and history reuses still-held rows`, async () => {
    const f = fixture();
    const { store, close } = await f.open();
    try {
      await store[method]();
      const full = store.getState().snapshot!.rows.window;
      assert.equal(full.length, 4);
      f.snapshot();
      assert.equal(store.getState().snapshot!.rows.window.length, 2);
      await store[method]();
      const restored = store.getState().snapshot!.rows.window;
      assert.equal(restored.length, 4);
      restored.forEach((row, index) => assert.equal(row, full[index]));
      f.delta([{ op: "row.removed", fromRowId: 3 }]);
      assert.deepEqual(
        store.getState().snapshot!.rows.window.map((row) => row.rowId),
        [1, 2],
      );
      f.setRows([userRow(1)]);
      f.snapshot();
      assert.deepEqual(
        store.getState().snapshot!.rows.window.map((row) => row.rowId),
        [1],
      );
    } finally {
      await close();
    }
  });
}

test("released view stops optional full-history hydration before committing older rows", async () => {
  const f = fixture();
  const rowsRange = f.transport.rowsRange;
  let calls = 0;
  let releaseRange = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseRange = resolve;
  });
  f.transport.rowsRange = async (params) => {
    calls++;
    await gate;
    return rowsRange(params);
  };
  const layer = new SessionDataLayer({ transport: f.transport, keepWarmMs: 1_000 });
  const lease = layer.acquire("session");
  try {
    if (!lease.store.getState().snapshot) {
      await new Promise<void>((resolve) => {
        const off = lease.store.subscribe(() => {
          if (!lease.store.getState().snapshot) return;
          off();
          resolve();
        });
      });
    }
    const initialRows = lease.store.getState().snapshot!.rows.window;
    const hydration = lease.store.loadAllOlder();
    assert.equal(calls, 1);
    lease.release();
    releaseRange();
    assert.equal((await hydration).status, "stale");
    assert.equal(calls, 1);
    assert.equal(lease.store.getState().snapshot!.rows.window, initialRows);
  } finally {
    releaseRange();
    lease.release();
    layer.dispose();
  }
});

test("navigator outline keeps full query directory without retaining older body rows", async () => {
  const f = fixture();
  const rows: ConversationRow[] = [];
  for (let index = 0; index < 300; index++) {
    const turnId = `turn-${index}`;
    rows.push({
      ...userRow(index * 2 + 1),
      turnId,
      text: `question-${index} ` + "q".repeat(1_000),
    });
    rows.push({
      ...textRow(index * 2 + 2, `answer-${index} ` + "a".repeat(10_000)),
      turnId,
    });
  }
  f.setRows(rows, 60);
  const { store, close } = await f.open();
  try {
    const originalWindow = store.getState().snapshot!.rows.window;
    assert.equal((await store.loadTurnNavigatorDirectory()).status, "hydrated");
    const state = store.getState();
    assert.equal(state.snapshot!.rows.window, originalWindow);
    assert.equal(state.turnNavigatorDirectory.length, 270);
    assert.equal(state.turnNavigatorDirectory[0]?.rowId, 1);
    assert.equal(state.turnNavigatorDirectory[0]?.userText.length, 220);
    assert.equal(state.turnNavigatorDirectory[0]?.assistantText?.length, 220);
    assert.equal(await store.loadOlderThrough(1), true);
    assert.equal(store.getState().snapshot!.rows.window[0]?.rowId, 1);
    assert.equal(store.getState().turnNavigatorDirectory.length, 0);
  } finally {
    await close();
  }
});

test("stale navigator outline is discarded after a branch snapshot", async () => {
  const f = fixture();
  const { store, close } = await f.open();
  const rowsRange = f.transport.rowsRange;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  f.transport.rowsRange = async (params) => {
    await gate;
    return rowsRange(params);
  };
  try {
    const pending = store.loadTurnNavigatorDirectory();
    f.setRows([userRow(3), textRow(4)]);
    f.snapshot();
    release();
    assert.equal((await pending).status, "stale");
    assert.deepEqual(store.getState().turnNavigatorDirectory, []);
  } finally {
    release();
    await close();
  }
});

test("stale history cannot enter projection or replace pool entries", async () => {
  const f = fixture();
  const { store, close } = await f.open();
  try {
    await store.loadOlder();
    const full = store.getState().snapshot!.rows.window;
    f.snapshot();
    const rowsRange = f.transport.rowsRange;
    f.transport.rowsRange = async (params) => {
      const result = await rowsRange(params);
      return { ...result, atLogEpoch: "stale", rows: [textRow(2, "wrong branch")] };
    };
    await store.loadOlder();
    assert.equal(store.getState().snapshot!.rows.window.length, 2);
    f.transport.rowsRange = rowsRange;
    await store.loadOlder();
    assert.equal(store.getState().snapshot!.rows.window[1], full[1]);
    f.setEpoch("next-epoch");
    f.setRows([textRow(2, "new branch")]);
    f.snapshot("recovery");
    const next = store.getState().snapshot!;
    assert.equal(next.logEpoch, "next-epoch");
    assert.notEqual(next.rows.window[0], full[1]);
    assert.equal(
      next.rows.window[0]?.kind === "assistantText" && next.rows.window[0].text,
      "new branch",
    );
  } finally {
    await close();
  }
});

test("one data layer shares live rows after store expiry while other connections stay isolated", async () => {
  const f = fixture();
  const layer = new SessionDataLayer({ transport: f.transport, keepWarmMs: 0 });
  const lease = layer.acquire("session");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const row = lease.store.getState().snapshot!.rows.window[0];
  const closed = new Promise<void>((resolve) => {
    const off = lease.store.subscribe(() => {
      if (lease.store.getState().status === "closed") {
        off();
        resolve();
      }
    });
  });
  lease.release();
  await closed;
  const reopened = layer.acquire("session");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const otherFixture = fixture();
  const other = new SessionDataLayer({ transport: otherFixture.transport });
  const otherLease = other.acquire("session");
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert.equal(reopened.store.getState().snapshot!.rows.window[0], row);
    assert.notEqual(otherLease.store.getState().snapshot!.rows.window[0], row);
  } finally {
    reopened.release();
    otherLease.release();
    layer.dispose();
    other.dispose();
  }
});
