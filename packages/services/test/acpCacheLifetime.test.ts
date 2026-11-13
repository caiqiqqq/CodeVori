import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acpSessionSchema } from "@zcode/shared";
import { AcpSessionStore } from "../src/acp/acpSessionStore.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acp-cache-lifetime-"));
  const scope = {
    id: randomUUID(),
    workspacePath: "/synthetic/cache",
    workspaceIdentity: "remote:cache",
  };
  const session = acpSessionSchema.parse({
    ...scope,
    agent: "codex",
    acpSessionId: "native",
    title: "history",
    revision: 1,
    status: "idle",
    pendingPermission: null,
    error: null,
    entries: [{ id: "user:old", kind: "user", text: "saved", createdAt: 1 }],
  });
  await writeFile(join(directory, `${scope.id}.json`), JSON.stringify(session));
  return { directory, scope, session };
}

test("last observer releases disconnected history and concurrent reopening shares one owner", async (t) => {
  const f = await fixture();
  const reads = t.mock.method(AcpSessionStore.prototype, "read");
  const releases = t.mock.method(AcpSessionStore.prototype, "release");
  const service = createAcpService({ directory: f.directory });
  const subscribe = () =>
    service.onDynamicConversationChanged({ ...f.scope, subscriptionId: randomUUID() })(() => {});
  let subscription = subscribe();
  try {
    await Promise.all([
      service.readConversation({ ...f.scope, subscriptionId: "first" }),
      service.conversationRowsRange({ ...f.scope, limit: 200, navigationOnly: true }),
    ]);
    assert.equal(reads.mock.callCount(), 1, "projection shares the committed snapshot");
    assert.equal(releases.mock.callCount(), 0);
    subscription.dispose();
    assert.equal(releases.mock.callCount(), 1);
    subscription = subscribe();
    const [left, right] = await Promise.all([service.read(f.scope), service.read(f.scope)]);
    assert.deepEqual(left, f.session);
    assert.deepEqual(right, f.session);
    assert.equal(reads.mock.callCount(), 2, "one load for both reopened callers");
    assert.equal(releases.mock.callCount(), 1);
  } finally {
    subscription.dispose();
    await service.disposeAllAndWait();
    await rm(f.directory, { recursive: true, force: true });
  }
});

for (const fail of [false, true]) {
  test(`unsubscribe during ${fail ? "failed" : "successful"} persistence retains the owner until RPC completes`, async (t) => {
    const f = await fixture();
    const entered = deferred(),
      gate = deferred();
    const original = AcpSessionStore.prototype.commit;
    t.mock.method(
      AcpSessionStore.prototype,
      "commit",
      async function (this: AcpSessionStore, ...args: Parameters<typeof original>) {
        entered.resolve();
        await gate.promise;
        if (fail) throw new Error("fixture write failed");
        return original.apply(this, args);
      },
    );
    const reads = t.mock.method(AcpSessionStore.prototype, "read");
    const releases = t.mock.method(AcpSessionStore.prototype, "release");
    const service = createAcpService({ directory: f.directory });
    const subscription = service.onDynamicConversationChanged({
      ...f.scope,
      subscriptionId: "sub",
    })(() => {});
    try {
      await service.read(f.scope);
      const write = service.updateRow({ ...f.scope, action: { kind: "rename", title: "changed" } });
      const result = write.then(
        () => null,
        (error) => error,
      );
      await entered.promise;
      subscription.dispose();
      assert.equal(releases.mock.callCount(), 0);
      await service.read(f.scope);
      assert.equal(reads.mock.callCount(), 1, "the in-flight writer keeps the same owner");
      gate.resolve();
      const error = await result;
      assert.equal(Boolean(error), fail);
      assert.equal(releases.mock.callCount(), fail ? 0 : 1, "failed unsaved facts remain resident");
      if (!fail) {
        assert.equal((await service.read(f.scope)).title, "changed");
        assert.equal(reads.mock.callCount(), 2);
      }
    } finally {
      gate.resolve();
      subscription.dispose();
      await service.disposeAllAndWait();
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("a connected idle Agent retains its callback owner until exit persistence completes", async (t) => {
  const f = await fixture();
  const releases = t.mock.method(AcpSessionStore.prototype, "release");
  let exit!: (reason: string) => void;
  const connect: AcpConnectionFactory = async (options) => {
    exit = options.onExit;
    return {
      sessionId: "native",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({ directory: f.directory, connect });
  try {
    await service.refresh(f.scope);
    assert.equal(releases.mock.callCount(), 0);
    exit("fixture exit");
    assert.equal(releases.mock.callCount(), 0);
    // 等待同一 owner 的保存队列，不用计时器猜测落盘完成。
    await service.disposeAllAndWait();
    assert.ok(releases.mock.callCount() >= 1);
    const restored = await new AcpSessionStore((id) => join(f.directory, `${id}.json`)).read(
      f.scope.id,
    );
    assert.equal(restored.entries[0]!.text, "saved");
  } finally {
    await service.disposeAllAndWait();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("accepted paused queue keeps its owner after observer release", async (t) => {
  const f = await fixture();
  f.session.queue.items.push({
    commandId: "queued",
    text: "accepted",
    attachments: [],
    workspaceFiles: [],
    createdAt: 2,
    state: "queued",
  });
  await writeFile(join(f.directory, `${f.scope.id}.json`), JSON.stringify(f.session));
  const releases = t.mock.method(AcpSessionStore.prototype, "release");
  const service = createAcpService({ directory: f.directory });
  const subscription = service.onDynamicConversationChanged({
    ...f.scope,
    subscriptionId: "queue",
  })(() => {});
  try {
    const owner = await service.read(f.scope);
    assert.equal(owner.queue.items.length, 1);
    subscription.dispose();
    assert.equal(releases.mock.callCount(), 0);
    assert.equal((await service.read(f.scope)).queue.items[0]!.commandId, "queued");
  } finally {
    await service.disposeAllAndWait();
    await rm(f.directory, { recursive: true, force: true });
  }
});
