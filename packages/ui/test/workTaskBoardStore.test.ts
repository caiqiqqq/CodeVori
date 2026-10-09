import assert from "node:assert/strict";
import { test } from "node:test";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskBoard } from "@zcode/shared";
import { getWorkTaskBoardReader } from "../src/store/workTaskBoardStore.js";

const scope = { workspacePath: "/synthetic/project" };
const board = (concurrency: number): WorkTaskBoard => ({ tasks: [], concurrency });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const listeners = new Set<() => void>();
  const pending: { resolve(board: WorkTaskBoard): void; reject(error: Error): void }[] = [];
  let reads = 0;
  let subscriptions = 0;
  const service = {
    list() {
      reads++;
      return new Promise<WorkTaskBoard>((resolve, reject) => pending.push({ resolve, reject }));
    },
    onDynamicChanged: () => (listener: () => void) => {
      subscriptions++;
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as IWorkTaskService;
  return {
    service,
    pending,
    listeners,
    get reads() {
      return reads;
    },
    get subscriptions() {
      return subscriptions;
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

test("board and sidebar share one Host read and subscription, releasing the last consumer", async () => {
  const f = fixture();
  const reader = getWorkTaskBoardReader(f.service, scope, false);
  assert.equal(getWorkTaskBoardReader(f.service, { ...scope }, false), reader);
  const releaseBoard = reader.acquire();
  const releaseSidebar = reader.acquire();
  await settle();
  assert.equal(f.reads, 1);
  assert.equal(f.subscriptions, 1);
  f.pending.shift()!.resolve(board(2));
  await settle();
  assert.deepEqual(reader.store.getState().board, board(2));
  releaseBoard();
  assert.equal(f.listeners.size, 1);
  releaseSidebar();
  assert.equal(f.listeners.size, 0);
  assert.equal(reader.store.getState().board, null);
  const release = reader.acquire();
  await settle();
  assert.equal(f.reads, 2, "reentering must read current Host facts");
  release();
  f.pending.shift()!.resolve(board(3));
  await settle();
  assert.equal(reader.store.getState().board, null, "late response cannot restore released data");
});

test("notifications during a read discard stale data and coalesce into one follow-up", async () => {
  const f = fixture();
  const reader = getWorkTaskBoardReader(f.service, scope, false);
  const release = reader.acquire();
  await settle();
  f.notify();
  f.notify();
  f.notify();
  f.pending.shift()!.resolve(board(1));
  await settle();
  assert.equal(reader.store.getState().board, null);
  assert.equal(f.reads, 2);
  f.pending.shift()!.resolve(board(4));
  await settle();
  assert.deepEqual(reader.store.getState().board, board(4));
  const version = reader.eventVersion;
  f.notify();
  reader.refreshAfterMutation(version);
  await settle();
  assert.equal(f.reads, 3, "command completion must reuse its change notification read");
  f.pending.shift()!.resolve(board(5));
  await settle();
  release();
});

test("mutation without notification refreshes in background, read failure retains the previous board", async () => {
  const f = fixture();
  const reader = getWorkTaskBoardReader(f.service, scope, false);
  const release = reader.acquire();
  await settle();
  f.pending.shift()!.resolve(board(1));
  await settle();
  assert.equal(reader.refreshAfterMutation(reader.eventVersion), undefined);
  await settle();
  f.pending.shift()!.reject(new Error("Synthetic list failed"));
  await settle();
  assert.deepEqual(reader.store.getState().board, board(1));
  assert.equal(reader.store.getState().error, "Synthetic list failed");
  f.notify();
  await settle();
  f.pending.shift()!.resolve(board(2));
  await settle();
  assert.equal(reader.store.getState().error, null);
  release();
});

test("Host, identity, path, remote session and archive scope never share a projection", () => {
  const a = fixture(),
    b = fixture();
  const reader = getWorkTaskBoardReader(a.service, scope, false);
  for (const candidate of [
    getWorkTaskBoardReader(b.service, scope, false),
    getWorkTaskBoardReader(a.service, scope, true),
    getWorkTaskBoardReader(a.service, { ...scope, workspaceIdentity: "remote-a" }, false),
    getWorkTaskBoardReader(a.service, { ...scope, remoteSessionId: "host-a" }, false),
    getWorkTaskBoardReader(a.service, { workspacePath: "/synthetic/other" }, false),
  ])
    assert.notEqual(candidate, reader);
  const identity = { ...scope, workspaceIdentity: " remote-a " };
  assert.equal(
    getWorkTaskBoardReader(a.service, identity, false),
    getWorkTaskBoardReader(a.service, { ...identity, workspaceIdentity: "remote-a" }, false),
  );
});

test("released request cannot overwrite a new subscription even when it completes last", async () => {
  const f = fixture();
  const reader = getWorkTaskBoardReader(f.service, scope, false);
  const releaseOld = reader.acquire();
  await settle();
  const old = f.pending.shift()!;
  releaseOld();
  const releaseNew = reader.acquire();
  await settle();
  f.pending.shift()!.resolve(board(2));
  await settle();
  old.resolve(board(1));
  await settle();
  assert.deepEqual(reader.store.getState().board, board(2));
  releaseNew();
});

test("notification during Promise finalization still triggers the latest read", async () => {
  const f = fixture();
  const reader = getWorkTaskBoardReader(f.service, scope, false);
  const release = reader.acquire();
  const unsubscribe = reader.store.subscribe((state) => {
    if (state.board?.concurrency === 1) queueMicrotask(() => f.notify());
  });
  await settle();
  f.pending.shift()!.resolve(board(1));
  await settle();
  assert.equal(f.reads, 2);
  f.pending.shift()!.resolve(board(2));
  await settle();
  assert.deepEqual(reader.store.getState().board, board(2));
  unsubscribe();
  release();
});
