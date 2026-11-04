import assert from "node:assert/strict";
import test from "node:test";
import { createWindowRemoteConnectionRegistry } from "../src/host/windowRemoteConnectionRegistry.js";

function createFixture() {
  let nextId = 0;
  let connections = 0;
  let disposals = 0;
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `session-${++nextId}`,
    connect: async () => {
      connections += 1;
      return {
        services: { connection: connections },
        dispose: () => {
          disposals += 1;
        },
      };
    },
  });
  const connect = (container: string, project: string) =>
    registry.connect({
      requestId: `${container}:${project}`,
      target: { kind: "docker", container },
      remoteAssets: {},
      workspacePath: `/work/${project}`,
      workspaceIdentity: `remote:docker:${container}:/work/${project}`,
    });
  return {
    registry,
    connect,
    get connections() {
      return connections;
    },
    get disposals() {
      return disposals;
    },
  };
}

test("projects in one Docker container share a connection until the last project closes", async () => {
  const fixture = createFixture();
  try {
    const [alpha, beta] = await Promise.all([
      fixture.connect("shared", "alpha"),
      fixture.connect("shared", "beta"),
    ]);
    assert.equal(fixture.connections, 1);
    assert.deepEqual(fixture.registry.getStats(), {
      connectionCount: 1,
      logicalSessionCount: 2,
    });

    await fixture.registry.disposeSession(alpha.remoteSessionId);
    assert.equal(fixture.disposals, 0);
    assert.equal(
      fixture.registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: beta.remoteSessionId,
        workspacePath: "/work/beta",
        workspaceIdentity: "remote:docker:shared:/work/beta",
      }).connection,
      1,
    );

    await fixture.registry.disposeSession(beta.remoteSessionId);
    assert.equal(fixture.disposals, 1);
    assert.equal(fixture.registry.getStats().connectionCount, 0);
  } finally {
    await fixture.registry.dispose();
  }
});

test("Docker containers keep independent connection owners", async () => {
  const fixture = createFixture();
  try {
    const [alpha, beta] = await Promise.all([
      fixture.connect("first", "alpha"),
      fixture.connect("second", "beta"),
    ]);
    assert.equal(fixture.connections, 2);
    await fixture.registry.disposeSession(alpha.remoteSessionId);
    assert.equal(fixture.disposals, 1);
    assert.equal(fixture.registry.getSession(beta.remoteSessionId)?.state, "online");
  } finally {
    await fixture.registry.dispose();
  }
});

test("canceling the last Docker waiter does not reuse its stale connect flight", async () => {
  let releaseFirst!: (handle: { services: { connection: number }; dispose(): void }) => void;
  let attempts = 0;
  let staleDisposals = 0;
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `session-${++attempts}`,
    connect: async () => {
      if (attempts === 1) {
        return await new Promise<{
          services: { connection: number };
          dispose(): void;
        }>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { services: { connection: attempts }, dispose: () => undefined };
    },
  });
  const connect = (requestId: string) =>
    registry.connect({
      requestId,
      target: { kind: "docker", container: "shared" },
      remoteAssets: {},
    });
  try {
    const canceled = connect("first");
    registry.cancelConnect("first");
    await assert.rejects(canceled, /远程连接已取消/);
    const current = await connect("second");
    assert.equal(attempts, 2);
    assert.equal(registry.getSession(current.remoteSessionId)?.state, "online");
    releaseFirst({
      services: { connection: 1 },
      dispose: () => {
        staleDisposals += 1;
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(staleDisposals, 1);
    assert.equal(registry.getSession(current.remoteSessionId)?.state, "online");
  } finally {
    await registry.dispose();
  }
});

test("different routes to one Source Server join one physical owner after handshake", async () => {
  let connections = 0;
  let disposals = 0;
  let nextId = 0;
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `session-${++nextId}`,
    connect: async () => {
      connections += 1;
      return {
        sourceServerId: "e3d8ea59-4b47-4ef4-a2d8-398d7361c669",
        services: { owner: connections },
        dispose: () => {
          disposals += 1;
        },
      };
    },
  });
  const connect = (requestId: string, host: string) =>
    registry.connect({
      requestId,
      target: { kind: "ssh", host, username: "alice" },
      remoteAssets: {},
      workspacePath: `/work/${requestId}`,
      workspaceIdentity: `remote:ssh:${host}:22:alice:/work/${requestId}`,
    });
  try {
    const first = await connect("first", "192.0.2.10");
    const second = await connect("second", "host.example.test");
    assert.equal(connections, 2);
    assert.equal(disposals, 1);
    assert.equal(registry.getStats().connectionCount, 1);
    assert.equal(
      registry.resolveScopedServices({
        kind: "remote",
        remoteSessionId: second.remoteSessionId,
        workspacePath: "/work/second",
        workspaceIdentity: "remote:ssh:host.example.test:22:alice:/work/second",
      }).owner,
      1,
    );
    const third = await connect("third", "host.example.test");
    assert.equal(connections, 2);
    await registry.disposeSession(first.remoteSessionId);
    assert.equal(registry.getSession(third.remoteSessionId)?.state, "online");
  } finally {
    await registry.dispose();
  }
});

test("a delayed route join cannot overwrite a newer connection for that route", async () => {
  let releaseDuplicate!: () => void;
  let nextId = 0;
  let secondRouteAttempts = 0;
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `session-${++nextId}`,
    connect: async ({ target }) => {
      if (target.kind !== "ssh") throw new Error("unexpected target");
      if (target.host === "alias.example.test") {
        secondRouteAttempts += 1;
        if (secondRouteAttempts === 1) {
          return {
            sourceServerId: "e3d8ea59-4b47-4ef4-a2d8-398d7361c669",
            services: { owner: "duplicate" },
            dispose: () =>
              new Promise<void>((resolve) => {
                releaseDuplicate = resolve;
              }),
          };
        }
        return {
          sourceServerId: "df0a173e-e05c-4ac8-aafa-a432014b47fb",
          services: { owner: "replacement" },
          dispose: () => undefined,
        };
      }
      return {
        sourceServerId: "e3d8ea59-4b47-4ef4-a2d8-398d7361c669",
        services: { owner: "original" },
        dispose: () => undefined,
      };
    },
  });
  const connect = (requestId: string, host: string) =>
    registry.connect({
      requestId,
      target: { kind: "ssh", host, username: "alice" },
      remoteAssets: {},
    });
  try {
    await connect("original", "primary.example.test");
    const staleJoin = connect("stale", "alias.example.test");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const replacement = await connect("replacement", "alias.example.test");
    releaseDuplicate();
    await assert.rejects(staleJoin, /Source Server connection changed during route join/);
    const current = await connect("current", "alias.example.test");
    assert.equal(secondRouteAttempts, 2);
    assert.equal(
      registry.getSession(replacement.remoteSessionId)?.sourceServerId,
      current.sourceServerId,
    );
  } finally {
    releaseDuplicate?.();
    await registry.dispose();
  }
});

test("a failed joined workspace releases its current WSL owner", async () => {
  let rejectRelease!: (error: Error) => void;
  let releaseStarted!: () => void;
  const releasePending = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  const registry = createWindowRemoteConnectionRegistry({
    createId: (() => {
      let nextId = 0;
      return () => `session-${++nextId}`;
    })(),
    wslIdleTtlMs: 1,
    releaseWorkspace: () => {
      releaseStarted();
      return new Promise<void>((_resolve, reject) => {
        rejectRelease = reject;
      });
    },
    connect: async () => ({
      sourceServerId: "e3d8ea59-4b47-4ef4-a2d8-398d7361c669",
      services: {},
      dispose: () => undefined,
    }),
  });
  const connect = (
    requestId: string,
    target: { kind: "wsl"; distro: string } | { kind: "ssh"; host: string; username: string },
  ) =>
    registry.connect({
      requestId,
      target,
      remoteAssets: {},
      workspacePath: "/work/project",
      workspaceIdentity: "remote:source:project",
    });
  try {
    const first = await connect("first", { kind: "wsl", distro: "Ubuntu" });
    const disposal = registry.disposeSession(first.remoteSessionId);
    await releasePending;
    const joined = connect("joined", {
      kind: "ssh",
      host: "alias.example.test",
      username: "alice",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    rejectRelease(new Error("workspace release failed"));
    await disposal;
    await assert.rejects(joined, /workspace release failed/);
    assert.equal(registry.getStats().logicalSessionCount, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(registry.getStats().connectionCount, 0);
  } finally {
    rejectRelease?.(new Error("test cleanup"));
    await registry.dispose();
  }
});

test("explicit stop closes every project of one physical owner and preserves other devices", async () => {
  const fixture = createFixture();
  try {
    const a = await fixture.connect("shared", "a");
    const b = await fixture.connect("shared", "b");
    const other = await fixture.connect("other", "a");
    await fixture.registry.stopService(a.remoteSessionId);
    assert.equal(fixture.disposals, 1);
    assert.equal(fixture.registry.getSession(a.remoteSessionId), null);
    assert.equal(fixture.registry.getSession(b.remoteSessionId), null);
    assert.equal(fixture.registry.getSession(other.remoteSessionId)?.state, "online");
    await assert.rejects(fixture.registry.stopService(a.remoteSessionId), /不可用/);
    const replacement = await fixture.connect("shared", "a");
    assert.equal(fixture.connections, 3);
    assert.equal(fixture.registry.getSession(replacement.remoteSessionId)?.state, "online");
  } finally {
    await fixture.registry.dispose();
  }
});

test("late stop completion cannot remove a replacement connection", async () => {
  let release!: () => void;
  let next = 0,
    connections = 0;
  const closed: string[] = [];
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `stop-${++next}`,
    onSessionClosed: (event) => closed.push(event.remoteSessionId),
    connect: async () => ({
      services: { owner: ++connections },
      dispose:
        connections === 1
          ? () =>
              new Promise<void>((resolve) => {
                release = resolve;
              })
          : () => {},
    }),
  });
  const connect = (requestId: string) =>
    registry.connect({
      requestId,
      target: { kind: "docker", container: "fixture" },
      remoteAssets: {},
    });
  try {
    const old = await connect("old");
    const stopping = registry.stopService(old.remoteSessionId);
    const replacement = await connect("replacement");
    release();
    await stopping;
    assert.deepEqual(closed, [old.remoteSessionId]);
    assert.equal(registry.getSession(replacement.remoteSessionId)?.state, "online");
    assert.equal(registry.getStats().logicalSessionCount, 1);
  } finally {
    release?.();
    await registry.dispose();
  }
});

test("failed stop releases invalidated sessions and reports the transport error", async () => {
  let next = 0;
  const closed: { remoteSessionId: string; error?: string }[] = [];
  const registry = createWindowRemoteConnectionRegistry({
    createId: () => `failed-stop-${++next}`,
    onSessionClosed: (event) => closed.push(event),
    connect: async ({ target }) => ({
      services: {},
      dispose: () => {
        if (target.kind === "docker" && target.container === "failing")
          throw Error("transport stop failed");
      },
    }),
  });
  const connect = (container: string, requestId: string) =>
    registry.connect({ requestId, target: { kind: "docker", container }, remoteAssets: {} });
  try {
    const a = await connect("failing", "a");
    const b = await connect("failing", "b");
    const other = await connect("other", "other");
    await assert.rejects(registry.stopService(a.remoteSessionId), /transport stop failed/);
    assert.equal(registry.getSession(a.remoteSessionId), null);
    assert.equal(registry.getSession(b.remoteSessionId), null);
    assert.deepEqual(
      closed.map((event) => event.remoteSessionId),
      [a.remoteSessionId, b.remoteSessionId],
    );
    assert.ok(closed.every((event) => event.error === "transport stop failed"));
    assert.equal(registry.getSession(other.remoteSessionId)?.state, "online");
  } finally {
    await registry.dispose();
  }
});
