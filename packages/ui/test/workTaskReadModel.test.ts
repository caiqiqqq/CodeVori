import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskBoard } from "@zcode/shared";
import { getWorkTaskReadModel } from "../src/hooks/workTaskReadModel.js";

function host() {
  const listeners = new Set<() => void>();
  const reads: Array<{ resolve(value: WorkTaskBoard): void; reject(error: Error): void }> = [];
  let subscriptions = 0;
  const service = {
    list: () => new Promise<WorkTaskBoard>((resolve, reject) => reads.push({ resolve, reject })),
    onDynamicChanged: () => (listener: () => void) => {
      subscriptions++;
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as IWorkTaskService;
  return { service, listeners, reads, subscriptions: () => subscriptions };
}
const scope = { workspacePath: "/project" };
const board = (concurrency: number): WorkTaskBoard => ({ tasks: [], concurrency });
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("sidebar and board share one initial read and Host subscription", async () => {
  const h = host();
  const sidebar = getWorkTaskReadModel(h.service, scope, false);
  const panel = getWorkTaskReadModel(h.service, { ...scope }, false);
  assert.equal(sidebar, panel);
  const closeSidebar = sidebar.subscribe(() => {});
  const closePanel = panel.subscribe(() => {});
  assert.equal(h.reads.length, 1);
  assert.equal(h.subscriptions(), 1);
  h.reads[0]!.resolve(board(1));
  await settle();
  assert.equal(sidebar.getSnapshot().data?.concurrency, 1);
  closePanel();
  assert.equal(h.listeners.size, 1);
  closeSidebar();
  assert.equal(h.listeners.size, 0);
  assert.equal(sidebar.getSnapshot().data, null);
});

test("Host event during a read immediately reads the new board and discards a late old result", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  for (const listener of h.listeners) listener();
  assert.equal(h.reads.length, 2);
  h.reads[1]!.resolve(board(2));
  await settle();
  h.reads[0]!.resolve(board(1));
  await settle();
  assert.equal(read.getSnapshot().data?.concurrency, 2);
  close();
});

test("concurrent background refreshes reuse the pending read", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  const first = read.refresh();
  const second = read.refresh();
  assert.equal(first, second);
  assert.equal(h.reads.length, 1);
  h.reads[0]!.resolve(board(1));
  await Promise.all([first, second]);
  close();
});

test("background refresh and failure retain the current board", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  h.reads[0]!.resolve(board(3));
  await settle();
  const refresh = read.refresh();
  assert.equal(read.getSnapshot().loading, false);
  assert.equal(read.getSnapshot().data?.concurrency, 3);
  h.reads[1]!.reject(new Error("disconnected"));
  await refresh;
  assert.equal(read.getSnapshot().data?.concurrency, 3);
  assert.equal(read.getSnapshot().error, "disconnected");
  close();
});

test("a mutation refresh waits for a post-mutation read, not an already pending result", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  let done = false;
  const refresh = read.refresh(true).then(() => {
    done = true;
  });
  h.reads[0]!.resolve(board(1));
  await settle();
  assert.equal(done, false);
  h.reads[1]!.resolve(board(4));
  await refresh;
  assert.equal(read.getSnapshot().data?.concurrency, 4);
  close();
});

test("unsubscribe and resubscribe invalidate the old request, including StrictMode replay", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  read.subscribe(() => {})();
  const close = read.subscribe(() => {});
  h.reads[1]!.resolve(board(5));
  await settle();
  h.reads[0]!.resolve(board(1));
  await settle();
  assert.equal(read.getSnapshot().data?.concurrency, 5);
  assert.equal(h.listeners.size, 1);
  close();
});

test("identity fallback, attachment, archived view and Host instances isolate reads", () => {
  const h = host();
  const local = getWorkTaskReadModel(h.service, scope, false);
  assert.equal(
    local,
    getWorkTaskReadModel(h.service, { ...scope, workspaceIdentity: "  " }, false),
  );
  assert.notEqual(local, getWorkTaskReadModel(host().service, scope, false));
  assert.notEqual(local, getWorkTaskReadModel(h.service, scope, true));
  const remote = { ...scope, workspaceIdentity: "remote-a", remoteSessionId: "a" };
  assert.notEqual(local, getWorkTaskReadModel(h.service, remote, false));
  assert.notEqual(
    getWorkTaskReadModel(h.service, remote, false),
    getWorkTaskReadModel(h.service, { ...remote, remoteSessionId: "b" }, false),
  );
  assert.notEqual(
    getWorkTaskReadModel(h.service, remote, false),
    getWorkTaskReadModel(h.service, { ...remote, workspacePath: "/other" }, false),
  );
});

test("successful mutation reuses its notification read without waiting or querying twice", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  h.reads[0]!.resolve(board(1));
  await settle();
  const version = read.getEventVersion();
  for (const listener of h.listeners) listener();
  assert.equal(read.refreshAfterMutation(version), undefined);
  assert.equal(h.reads.length, 2);
  h.reads[1]!.resolve(board(2));
  await settle();
  read.refreshAfterMutation(version);
  assert.equal(h.reads.length, 2, "completed notification must also prevent a redundant read");
  assert.equal(read.getSnapshot().data?.concurrency, 2);
  close();
});

test("mutation without notification starts background repair and list failure remains a read error", async () => {
  const h = host();
  const read = getWorkTaskReadModel(h.service, scope, false);
  const close = read.subscribe(() => {});
  h.reads[0]!.resolve(board(1));
  await settle();
  assert.equal(read.refreshAfterMutation(read.getEventVersion()), undefined);
  assert.equal(h.reads.length, 2);
  h.reads[1]!.reject(new Error("Synthetic list failed"));
  await settle();
  assert.equal(read.getSnapshot().data?.concurrency, 1);
  assert.equal(read.getSnapshot().error, "Synthetic list failed");
  for (const listener of h.listeners) listener();
  h.reads[2]!.resolve(board(2));
  await settle();
  assert.equal(read.getSnapshot().error, null);
  close();
});
