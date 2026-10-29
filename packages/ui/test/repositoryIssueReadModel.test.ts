import assert from "node:assert/strict";
import { test } from "node:test";
import type { IWorkTaskService } from "@zcode/services";
import type { RepositoryIssueSummary, RepositoryIssueSummaryRequest } from "@zcode/shared";
import {
  getRepositoryIssueReadModel,
  combineRepositoryIssueReads,
} from "../src/hooks/repositoryIssueReadModel.js";
import { repositoryIssueRefreshStore } from "../src/store/repositoryIssueRefreshStore.js";

const project = { workspacePath: "/project" };
const result = (pending: number) => ({ pending, checkedAt: 1000 });
const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};
function host() {
  const listeners = new Set<() => void>();
  const requests: Array<{
    input: RepositoryIssueSummaryRequest;
    resolve(value: RepositoryIssueSummary): void;
    reject(error: Error): void;
  }> = [];
  const service = {
    getRepositoryIssueSummary: (input: RepositoryIssueSummaryRequest) =>
      new Promise<RepositoryIssueSummary>((resolve, reject) =>
        requests.push({ input, resolve, reject }),
      ),
    onDynamicChanged: () => (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as IWorkTaskService;
  return { service, listeners, requests };
}

test("consumers share initial query, 60s timer and task subscription; release stops all IO", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = host();
  const a = getRepositoryIssueReadModel(h.service, [project]);
  const b = getRepositoryIssueReadModel(h.service, [{ ...project }]);
  assert.equal(a, b);
  const closeA = a.subscribe(() => {});
  const closeB = b.subscribe(() => {});
  assert.equal(h.requests.length, 1);
  assert.equal(h.listeners.size, 1);
  h.requests[0]!.resolve(result(2));
  await settle();
  t.mock.timers.tick(59_999);
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(h.requests.length, 2);
  h.requests[1]!.resolve(result(3));
  await settle();
  closeA();
  assert.equal(h.listeners.size, 1);
  closeB();
  t.mock.timers.tick(60_000);
  assert.equal(h.requests.length, 2);
  assert.equal(h.listeners.size, 0);
});

test("task acceptance refreshes links; Forge mutation forces remote revalidation and old results lose", async () => {
  const h = host();
  const read = getRepositoryIssueReadModel(h.service, [project]);
  const close = read.subscribe(() => {});
  try {
    for (const listener of h.listeners) listener();
    assert.equal(h.requests[1]!.input.force, false);
    h.requests[1]!.resolve(result(1));
    await settle();
    h.requests[0]!.resolve(result(9));
    await settle();
    assert.equal(read.getSnapshot().data?.pending, 1);
    repositoryIssueRefreshStore.getState().invalidate();
    assert.equal(h.requests[2]!.input.force, true);
    h.requests[2]!.resolve(result(0));
    await settle();
    assert.equal(read.getSnapshot().data?.pending, 0);
  } finally {
    close();
  }
});

test("failures retain a successful value and mark it stale instead of publishing zero", async () => {
  const h = host();
  const read = getRepositoryIssueReadModel(h.service, [project]);
  const combined = combineRepositoryIssueReads([{ resource: read, error: null }]);
  const close = combined.subscribe(() => {});
  try {
    h.requests[0]!.resolve(result(7));
    await settle();
    const stable = combined.getSnapshot();
    assert.equal(combined.getSnapshot(), stable);
    const refresh = read.refresh();
    h.requests[1]!.reject(new Error("FORGE_FORBIDDEN"));
    await refresh;
    assert.equal(combined.getSnapshot().count, 7);
    assert.equal(combined.getSnapshot().stale, true);
    const recovery = read.refresh();
    assert.equal(combined.getSnapshot().stale, true, "retrying is not a successful refresh");
    h.requests[2]!.resolve(result(8));
    await recovery;
    assert.equal(combined.getSnapshot().count, 8);
    assert.equal(combined.getSnapshot().stale, false);
  } finally {
    close();
  }
});

test("disconnected and switched Hosts never inherit another target's number", async () => {
  const a = host();
  const b = host();
  const old = getRepositoryIssueReadModel(a.service, [project]);
  const close = old.subscribe(() => {});
  close();
  const fresh = getRepositoryIssueReadModel(b.service, [
    { ...project, workspaceIdentity: "endpoint-b", remoteSessionId: "attachment-b" },
  ]);
  const combined = combineRepositoryIssueReads([{ resource: fresh, error: null }]);
  const stop = combined.subscribe(() => {});
  try {
    a.requests[0]!.resolve(result(42));
    await settle();
    assert.equal(combined.getSnapshot().count, null);
    assert.equal(b.requests[0]!.input.projects[0]?.remoteSessionId, "attachment-b");
    b.requests[0]!.resolve(result(2));
    await settle();
    assert.equal(combined.getSnapshot().count, 2);
    const disconnected = combineRepositoryIssueReads([{ resource: null, error: "DISCONNECTED" }]);
    assert.equal(disconnected.getSnapshot().count, null);
    assert.equal(disconnected.getSnapshot().stale, true);
  } finally {
    stop();
  }
});

test("a malformed first RPC response remains unknown until a valid read succeeds", async () => {
  const h = host();
  const read = getRepositoryIssueReadModel(h.service, [project]);
  const combined = combineRepositoryIssueReads([{ resource: read, error: null }]);
  const close = combined.subscribe(() => {});
  try {
    h.requests[0]!.resolve(result(-1));
    await settle();
    assert.equal(combined.getSnapshot().count, null);
    assert.equal(combined.getSnapshot().loading, false);
    assert.equal(combined.getSnapshot().stale, true);
    const recovery = read.refresh();
    h.requests[1]!.resolve(result(0));
    await recovery;
    assert.equal(combined.getSnapshot().count, 0);
    assert.equal(combined.getSnapshot().stale, false);
  } finally {
    close();
  }
});

test("all available Hosts contribute while missing Hosts and partial repository reads are explicit", async () => {
  const a = host();
  const b = host();
  const reads = [
    getRepositoryIssueReadModel(a.service, [project]),
    getRepositoryIssueReadModel(b.service, [{ workspacePath: "/other" }]),
  ];
  const combined = combineRepositoryIssueReads(
    reads.map((resource) => ({ resource, error: null })),
  );
  const stop = combined.subscribe(() => {});
  try {
    assert.equal(combined.getSnapshot().count, null);
    a.requests[0]!.resolve(result(2));
    await settle();
    assert.equal(combined.getSnapshot().count, 2);
    assert.equal(combined.getSnapshot().partial, true);
    b.requests[0]!.resolve({ ...result(3), incomplete: true });
    await settle();
    assert.equal(combined.getSnapshot().count, 5);
    assert.equal(combined.getSnapshot().partial, true);
    const refresh = reads[1]!.refresh();
    b.requests[1]!.resolve(result(4));
    await refresh;
    assert.equal(combined.getSnapshot().count, 6);
    assert.equal(combined.getSnapshot().partial, false);
    const disconnected = combineRepositoryIssueReads([
      { resource: reads[0]!, error: null },
      { resource: null, error: "DISCONNECTED" },
    ]);
    assert.equal(disconnected.getSnapshot().count, 2);
    assert.equal(disconnected.getSnapshot().partial, true);
    assert.equal(combineRepositoryIssueReads([]).getSnapshot().count, 0);
  } finally {
    stop();
  }
});

test("hidden pages pause polling and visibility recovery forces a fresh read", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
  const h = host();
  const read = getRepositoryIssueReadModel(h.service, [project]);
  const close = read.subscribe(() => {});
  try {
    h.requests[0]!.resolve(result(1));
    await settle();
    t.mock.timers.tick(120_000);
    assert.equal(h.requests.length, 1);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1]!.input.force, true);
    h.requests[1]!.resolve(result(2));
    await settle();
  } finally {
    close();
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
