import assert from "node:assert/strict";
import test from "node:test";
import { purgeSession } from "../src/zcode-protocol/session-purge.js";
import { SessionLifecycleGate } from "../src/zcode-protocol/session-lifecycle-gate.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

const params = {
  sessionId: "session-one",
  workspace: { workspaceKey: "/fixture/project", workspacePath: "/fixture/project" },
};
function fixture() {
  const calls: string[] = [];
  const record = {
    workspace: params.workspace,
    app: {
      runtime: { hasResidencyBlockingWork: () => false },
      close: async () => {
        calls.push("close");
      },
    },
    eventStore: {
      deleteSession: async () => {
        calls.push("events");
      },
    },
  };
  const context = {
    deps: {
      sessionStore: {
        purgeSession: async ({ checkOnly }: { checkOnly?: boolean }) => {
          calls.push(checkOnly ? "preflight" : "delete");
          return "deleted";
        },
        retainedSessionArtifactUris: async () => ["zcode-artifact://session-one/shared"],
      },
      purgeSessionArtifacts: async (_id: string, uris: string[]) => {
        assert.deepEqual(uris, ["zcode-artifact://session-one/shared"]);
        calls.push("artifacts");
      },
    },
    sessions: new Map([[params.sessionId, record]]),
    sessionLifecycleGate: new SessionLifecycleGate(),
    v4Interactions: { hasPendingForSession: () => false },
    v4Gateway: {
      hasResidencyBlockingCommands: () => false,
      withSessionMaintenance: async (_id: string, run: () => Promise<unknown>) => run(),
      purgeSessionState: () => {
        calls.push("removed");
      },
    },
  } as unknown as ZCodeProtocolAgentServerContext;
  return { calls, record, context };
}
test("purge drains app writes, preserves shared artifacts and publishes removal after durable cleanup", async () => {
  const { context, calls } = fixture();
  assert.deepEqual(await purgeSession(context, params), { status: "deleted" });
  assert.deepEqual(calls, ["preflight", "close", "artifacts", "delete", "removed", "events"]);
  assert.equal(context.sessions.size, 0);
});
test("runtime busy and foreign owner reject before close or filesystem deletion", async () => {
  const { context, record, calls } = fixture();
  record.app.runtime.hasResidencyBlockingWork = () => true;
  assert.deepEqual(await purgeSession(context, params), { status: "busy" });
  assert.deepEqual(calls, []);
  await assert.rejects(
    purgeSession(context, {
      ...params,
      workspace: { ...params.workspace, workspaceKey: "remote:other" },
    }),
    /workspace/,
  );
});
test("a cold activation holding lifecycle ownership finishes before purge checks idle", async () => {
  const { context, calls, record } = fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const activation = context.sessionLifecycleGate!.run(params.sessionId, async () => {
    started();
    await hold;
    record.app.runtime.hasResidencyBlockingWork = () => true;
  });
  await ready;
  const deletion = purgeSession(context, params);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  release();
  await activation;
  assert.deepEqual(await deletion, { status: "busy" });
});
test("filesystem failure leaves storage intact and registry retryable", async () => {
  const { context, calls } = fixture();
  context.deps.purgeSessionArtifacts = async () => {
    throw new Error("fixture IO failure");
  };
  await assert.rejects(purgeSession(context, params), /IO failure/);
  assert.ok(context.sessions.has(params.sessionId));
  assert.ok(!calls.includes("delete"));
  assert.equal(context.purgingSessionIds?.size, 0);
  context.deps.purgeSessionArtifacts = async () => {};
  assert.deepEqual(await purgeSession(context, params), { status: "deleted" });
});
