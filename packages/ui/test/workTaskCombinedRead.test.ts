import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTask, WorkTaskBoard } from "@zcode/shared";
import { getWorkTaskReadModel } from "../src/hooks/workTaskReadModel.js";
import { combineWorkTaskReads } from "../src/hooks/workTaskCombinedRead.js";

const scope = { workspacePath: "/project" };
function host() {
  const listeners = new Set<() => void>();
  const requests: Array<{ resolve(board: WorkTaskBoard): void; reject(error: Error): void }> = [];
  const service = {
    list: () => new Promise<WorkTaskBoard>((resolve, reject) => requests.push({ resolve, reject })),
    onDynamicChanged: () => (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as IWorkTaskService;
  return { requests, listeners, resource: getWorkTaskReadModel(service, scope, false) };
}
const board = (title: string): WorkTaskBoard => ({
  tasks: [{ ...scope, id: "same-id", title } as WorkTask],
  concurrency: 2,
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("all-project reads share project subscriptions, keep partial facts and attachment identities", async () => {
  const local = host();
  const remote = host();
  const attachment = { ...scope, workspaceIdentity: "remote-id", remoteSessionId: "host-b" };
  const all = combineWorkTaskReads([
    { resource: local.resource, error: null, scope },
    { resource: remote.resource, error: null, scope: attachment },
    { resource: null, error: "work-task.disconnected" },
  ]);
  const closeSidebar = local.resource.subscribe(() => {});
  const closeAll = all.subscribe(() => {});
  assert.equal(local.requests.length, 1);
  local.requests[0]!.resolve(board("local"));
  await settle();
  assert.equal(all.getSnapshot().loading, false);
  assert.equal(all.getSnapshot().settled, false, "partial reads cannot invalidate saved selection");
  assert.equal(all.getSnapshot().data?.tasks.length, 1);
  assert.equal(all.getSnapshot().error, "work-task.disconnected");
  remote.requests[0]!.resolve(board("remote"));
  await settle();
  const snapshot = all.getSnapshot();
  assert.equal(snapshot.settled, true);
  assert.equal(all.getSnapshot(), snapshot, "React external-store snapshot must be stable");
  assert.deepEqual(
    snapshot.data?.tasks.map((task) => [task.title, task.workspaceIdentity, task.remoteSessionId]),
    [
      ["local", undefined, undefined],
      ["remote", "remote-id", "host-b"],
    ],
  );
  closeAll();
  assert.equal(remote.listeners.size, 0);
  assert.equal(local.listeners.size, 1);
  closeSidebar();
  assert.equal(local.listeners.size, 0);
});

test("removed project releases its read and late responses cannot repopulate the new projection", async () => {
  const a = host();
  const b = host();
  const old = combineWorkTaskReads([
    { resource: a.resource, error: null },
    { resource: b.resource, error: null },
  ]);
  const close = old.subscribe(() => {});
  close();
  const current = combineWorkTaskReads([{ resource: a.resource, error: null }]);
  const finish = current.subscribe(() => {});
  a.requests[1]!.resolve(board("current"));
  b.requests[0]!.resolve(board("removed"));
  a.requests[0]!.resolve(board("old"));
  await settle();
  assert.deepEqual(
    current.getSnapshot().data?.tasks.map((task) => task.title),
    ["current"],
  );
  assert.equal(b.listeners.size, 0);
  finish();
});
