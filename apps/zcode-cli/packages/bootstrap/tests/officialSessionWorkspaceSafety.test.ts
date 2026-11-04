import assert from "node:assert/strict";
import test from "node:test";
import {
  activateSessionForResume,
  validateSessionActivationWorkspace,
} from "../src/zcode-protocol/server-operations.js";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { SessionLifecycleGate } from "../src/zcode-protocol/session-lifecycle-gate.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { ConversationV4Gateway, type V4GatewayHost } from "../src/zcode-protocol-v4/v4-gateway.js";

const workspace = {
  workspaceKey: "remote:docker:fixture:/work",
  workspaceIdentity: "remote:docker:fixture:/work",
  workspacePath: "/work",
  remoteSessionId: "connection-one",
};

test("warm resume rejects foreign workspace fields without mutating the resident", async () => {
  const record = { workspace };
  const context = {
    sessions: new Map([["session", record]]),
    deps: {},
    sessionLifecycleGate: new SessionLifecycleGate(),
  } as unknown as ZCodeProtocolAgentServerContext;
  for (const field of ["workspaceKey", "workspacePath", "workspaceIdentity", "remoteSessionId"]) {
    await assert.rejects(
      activateSessionForResume(context, {
        sessionId: "session",
        workspace: { ...workspace, [field]: "other" },
      }),
      /workspace/,
    );
    assert.equal(context.sessions.get("session"), record);
  }
  assert.equal(
    (await activateSessionForResume(context, { sessionId: "session", workspace })).record,
    record,
  );
  assert.equal((await activateSessionForResume(context, { sessionId: "session" })).record, record);
});

test("cold resume rejects a foreign identity or directory before app construction", async () => {
  let created = 0;
  const context = {
    sessions: new Map(),
    deps: {
      sessionStore: {
        getSession: async () => ({
          id: "session",
          workspaceID: workspace.workspaceIdentity,
          directory: workspace.workspacePath,
          path: workspace.workspacePath,
        }),
      },
      createZCodeApp: () => {
        created++;
        throw new Error("unexpected construction");
      },
    },
    sessionLifecycleGate: new SessionLifecycleGate(),
  } as unknown as ZCodeProtocolAgentServerContext;
  for (const incoming of [
    {
      ...workspace,
      workspaceIdentity: "remote:docker:other:/work",
      workspaceKey: "remote:docker:other:/work",
    },
    { ...workspace, workspacePath: "/other" },
    { ...workspace, workspaceKey: "forged-key" },
  ])
    await assert.rejects(
      activateSessionForResume(context, { sessionId: "session", workspace: incoming }),
      /workspace/,
    );
  assert.equal(created, 0);
  assert.equal(context.sessions.size, 0);
});

test("V4 warm subscription validates workspace before publisher lookup or frame delivery", async () => {
  let checks = 0;
  let frames = 0;
  const gateway = new ConversationV4Gateway({
    sessionExists: () => true,
    validateSessionWorkspace: async (_id, incoming) => {
      checks++;
      assert.equal(incoming?.workspaceIdentity, workspace.workspaceIdentity);
      throw new Error("foreign workspace");
    },
    emitWireFrame: () => {
      frames++;
    },
  } as V4GatewayHost);
  try {
    await assert.rejects(
      gateway.subscribe({
        topic: "conversation/session",
        connectionId: "connection",
        clientMode: "desktop-continuous",
        workspace,
      }),
      /foreign workspace/,
    );
    assert.equal(checks, 1);
    assert.equal(frames, 0);
  } finally {
    gateway.dispose();
  }
});

test("V4 preflight recognizes legacy WSL ownership without migrating or trusting caller identity", async () => {
  const path = "/home/fixture/work";
  const identity = buildRemoteWorkspaceIdentity(path, { kind: "wsl", distro: "Fixture" });
  for (const directory of [identity, `${path}/${identity}`]) {
    let writes = 0;
    const context = {
      sessions: new Map(),
      deps: {
        cwd: path,
        sessionStore: {
          getSession: async () => ({ id: "session", directory, path: directory }),
          repairLegacyRemoteSessionWorkspace: async () => {
            writes++;
            return true;
          },
        },
      },
    } as unknown as ZCodeProtocolAgentServerContext;
    await validateSessionActivationWorkspace(context, "session", {
      workspaceKey: identity,
      workspaceIdentity: identity,
      workspacePath: path,
    });
    const foreign = buildRemoteWorkspaceIdentity(path, { kind: "wsl", distro: "Other" });
    await assert.rejects(
      validateSessionActivationWorkspace(context, "session", {
        workspaceKey: foreign,
        workspaceIdentity: foreign,
        workspacePath: path,
      }),
      /workspace/,
    );
    assert.equal(writes, 0);
  }
});

for (const clientMode of ["desktop-continuous", "web-remote-replayable"] as const) {
  test(`V4 revalidates ownership after shared READY for ${clientMode}`, async () => {
    const { promise: ready, resolve: finishLoad } = Promise.withResolvers<{
      events: [];
      synthesized: boolean;
    }>();
    const { promise: loading, resolve: beganLoad } = Promise.withResolvers<void>();
    let authorized = true;
    let checks = 0;
    let frames = 0;
    let resumes = 0;
    let resident = false;
    const gateway = new ConversationV4Gateway({
      sessionExists: () => resident,
      resumePersistedSession: async () => {
        resumes++;
        resident = true;
        return { status: "resumed" };
      },
      validateSessionWorkspace: async () => {
        checks++;
        if (!authorized) throw new Error("foreign workspace");
      },
      loadPersistedEvents: () => {
        beganLoad();
        return ready;
      },
      emitWireFrame: () => {
        frames++;
      },
    } as unknown as V4GatewayHost);
    try {
      const first = gateway.subscribe({
        topic: "conversation/session",
        connectionId: "one",
        clientMode,
        workspace,
      });
      await loading;
      const second = gateway.subscribe({
        topic: "conversation/session",
        connectionId: "two",
        clientMode,
        workspace,
      });
      // 第二个调用已进入异步校验；让其在同一 hydration 上等待，然后模拟归属变化。
      await Promise.resolve();
      authorized = false;
      finishLoad({ events: [], synthesized: false });
      const results = await Promise.allSettled([first, second]);
      assert.ok(
        results.every(
          (result) =>
            result.status === "rejected" && /foreign workspace/.test(String(result.reason)),
        ),
      );
      assert.equal(checks, 4);
      assert.equal(resumes, 1);
      assert.equal(frames, 0);
    } finally {
      gateway.dispose();
    }
  });
}
