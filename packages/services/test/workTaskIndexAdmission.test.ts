import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Emitter } from "@zcode/rpc";
import {
  uuidv7,
  workTaskSchema,
  zcodeSessionStateSnapshotSchema,
  ZCODE_PROTOCOL_NAME,
  ZCODE_PROTOCOL_VERSION,
} from "@zcode/shared";
import {
  encodeTopicWireFrames,
  type SessionSummary,
  type SessionsIndexTopicFrame,
  type SessionsIndexTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import { openWorkTaskDatabase } from "../src/session/workTaskDatabase.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../src/zcode-agent/zcodeTaskIndexSyncer.js";

const scope = { workspacePath: "/project" };
const snapshot = (sessionId: string) =>
  zcodeSessionStateSnapshotSchema.parse({
    protocol: { name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION },
    session: {
      sessionId,
      workspace: { ...scope, workspaceKey: scope.workspacePath },
      sessionKind: "interactive",
      title: "Implement feature",
      mode: "build",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
    },
    settings: {
      model: { available: [] },
      thoughtLevel: { enabled: false, available: [] },
      mode: { current: "build" },
    },
    projection: {
      sessionId,
      status: "idle",
      mode: "build",
      turnCount: 1,
      totalTokenCount: 0,
      contextUsed: 0,
      contextWindow: 200000,
      pendingPermissions: [],
      activeToolCalls: [],
      backgroundJobs: [],
    },
    runtime: { eventSeq: 0, stateRevision: 0, pendingRequestIds: [] },
    messages: [],
  });
const summary = (sessionId: string, phase: SessionSummary["phase"]): SessionSummary => ({
  sessionId,
  workspaceId: scope.workspacePath,
  title: "Implement feature",
  phase,
  sessionEnded: false,
  hasBackgroundWork: false,
  createdAt: 1,
  lastActivityAt: 2,
});
async function settle() {
  for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "work-task-index-admission-"));
  const dbPath = join(directory, "work.sqlite");
  const db = await openWorkTaskDatabase(dbPath);
  const task = workTaskSchema.parse({
    ...scope,
    id: uuidv7(),
    title: "Owned",
    prompt: "Build",
    sourceBranch: "main",
    useWorktree: false,
    directBranch: "main",
    execution: {
      kind: "api",
      modelSelection: { providerId: "test", modelId: "test" },
      mode: "build",
    },
    status: "review",
    archived: false,
    runSeq: 1,
    stopPending: false,
    runText: "Build",
    commandId: uuidv7(),
    session: { kind: "api", id: "execution" },
    sessionRequestId: uuidv7(),
    merge: {
      id: uuidv7(),
      projectPath: scope.workspacePath,
      targetBranch: "main",
      phase: "failed",
      session: { kind: "api", id: "merge" },
      worktree: {
        rootPath: "/",
        path: scope.workspacePath,
        projectPath: scope.workspacePath,
        branchName: "merge/test",
        baseCommit: "base",
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  db.prepare("INSERT INTO work_tasks(id,workspace_key,status,data) VALUES(?,?,?,?)").run(
    task.id,
    scope.workspacePath,
    task.status,
    JSON.stringify(task),
  );
  db.close();
  const owner = new WorkTaskRepo(dbPath);
  await owner.ready();
  const index = new TaskIndexRepo(join(directory, "index.sqlite"));
  const frames = new Emitter<SessionsIndexTopicWireCandidate>();
  const reads: string[] = [];
  const events: string[] = [],
    terminals: string[] = [],
    ready: string[] = [];
  let checks = 0;
  let rejectOwnership = false;
  let ownershipBarrier: Promise<void> | undefined;
  type Options = Parameters<typeof createZCodeTaskIndexSyncer>[0];
  const syncer = createZCodeTaskIndexSyncer({
    taskIndexRepo: index,
    hiddenSessionIds: async (target) => {
      checks++;
      await ownershipBarrier;
      if (rejectOwnership) throw new Error("owner unavailable");
      return owner.conversationSessionIds(target, "api");
    },
    agentService: {
      onDynamicSessionsIndexFrame: () => frames.event,
      onDynamicWorkspaceConfigFrame: () => new Emitter().event,
      subscribeSessionsIndexV4: async () => ({
        ack: { subscriptionId: "index", logEpoch: "epoch" },
      }),
      subscribeWorkspaceConfigV4: async () => ({
        ack: { subscriptionId: "config", logEpoch: "epoch" },
      }),
      unsubscribeSessionsIndexV4: async () => {},
      unsubscribeWorkspaceConfigV4: async () => {},
      listSessions: async () => [],
      readSession: async ({ sessionId }: { sessionId: string }) => {
        reads.push(sessionId);
        return snapshot(sessionId);
      },
    } as unknown as Options["agentService"],
  });
  syncer.onDynamicWorkspaceEvent(scope)((event) => {
    if (event.type === "workspace_task_list_changed") events.push(event.taskId ?? "");
  });
  syncer.onSessionTerminalEvent(({ target }) => terminals.push(target.sessionId));
  syncer.onSessionReadyEvent(({ target }) => ready.push(target.sessionId));
  let seq = 0,
    ordinal = 0;
  const emit = (sessions: SessionSummary[], initial = false) => {
    const frame: SessionsIndexTopicFrame = {
      topic: `sessions-index/${scope.workspacePath}`,
      subscriptionId: "index",
      fromSeq: initial ? 0 : seq,
      toSeq: ++seq,
      sentAt: Date.now(),
      payload: initial
        ? {
            kind: "snapshot",
            snapshot: {
              protocolVersion: 1,
              workspaceId: scope.workspacePath,
              logEpoch: "epoch",
              sessions,
            },
          }
        : {
            kind: "deltas",
            deltas: sessions.map((session) => ({ op: "session.upserted", session })),
          },
    };
    for (const wire of encodeTopicWireFrames(frame, {
      topic: frame.topic,
      subscriptionId: "index",
      logicalFrameId: uuidv7(),
      logicalFrameOrdinal: ++ordinal,
      deliveryKind: initial ? "initial" : "online",
      measurePhysicalFrameBytes: () => 100,
    }))
      frames.fire(wire);
  };
  return {
    index,
    syncer,
    reads,
    events,
    terminals,
    ready,
    emit,
    checks: () => checks,
    rejectOwnership: () => {
      rejectOwnership = true;
    },
    holdOwnership: () => {
      let release!: () => void;
      ownershipBarrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async cleanup() {
      syncer.disposeAll();
      await settle();
      index.close();
      owner.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("source ingestion does not promote owned execution/merge sessions at hydration or live turns", async () => {
  const f = await fixture();
  try {
    f.syncer.ensureWorkspaceSubscription(scope);
    await settle();
    f.emit(
      [
        summary("execution", "running"),
        summary("merge", "running"),
        summary("ordinary", "completedSuccess"),
      ],
      true,
    );
    await settle();
    assert.deepEqual(
      (await f.index.listTaskMetas(scope)).map((x) => x.taskId),
      ["ordinary"],
    );
    f.emit([summary("execution", "completedSuccess"), summary("merge", "completedSuccess")]);
    f.emit([summary("execution", "running"), summary("ordinary-live", "running")]);
    f.emit([{ ...summary("execution", "running"), title: "Owned renamed" }]);
    await settle();
    assert.deepEqual(f.terminals.sort(), ["execution", "merge"]);
    assert.deepEqual(f.ready.sort(), ["execution", "merge"]);
    assert.ok(f.reads.includes("ordinary-live"));
    assert.ok(!f.reads.includes("execution") && !f.reads.includes("merge"));
    assert.ok(!f.events.includes("execution") && !f.events.includes("merge"));
    assert.equal(await f.index.getTaskMeta({ ...scope, taskId: "execution" }), null);
    assert.equal(await f.index.getTaskMeta({ ...scope, taskId: "merge" }), null);
    const structure = await f.index.queryGroupedTaskViewStructure({ workspaceScopes: [scope] });
    assert.ok(!JSON.stringify(structure).includes('"execution"'));
    assert.ok(!JSON.stringify(structure).includes('"merge"'));
    assert.ok(f.checks() > 0);
  } finally {
    await f.cleanup();
  }
});

test("explicit snapshot sync checks ownership before ordinary index/placement writes and fails closed", async () => {
  const f = await fixture();
  const options = { broadcastReason: "task_status_changed" as const, moveGroupedTaskToTop: true };
  try {
    const meta = await f.syncer.syncSnapshotAndBroadcast(snapshot("execution"), options);
    assert.equal(meta.taskId, "execution", "direct caller still receives its session metadata");
    assert.equal(await f.index.getTaskMeta({ ...scope, taskId: "execution" }), null);
    assert.deepEqual(f.events, []);
    await f.syncer.syncSnapshotAndBroadcast(snapshot("ordinary"), options);
    assert.ok(await f.index.getTaskMeta({ ...scope, taskId: "ordinary" }));
    assert.deepEqual(f.events, ["ordinary"]);
    f.rejectOwnership();
    await assert.rejects(
      f.syncer.syncSnapshotAndBroadcast(snapshot("unconfirmed"), options),
      /owner unavailable/,
    );
    assert.equal(await f.index.getTaskMeta({ ...scope, taskId: "unconfirmed" }), null);
  } finally {
    await f.cleanup();
  }
});

test("a late ownership answer cannot seed or publish after the ingest subscription is disposed", async () => {
  const f = await fixture();
  let release = () => {};
  try {
    f.syncer.ensureWorkspaceSubscription(scope);
    await settle();
    release = f.holdOwnership();
    f.emit([summary("ordinary", "running")], true);
    f.emit([summary("ordinary", "completedSuccess")]);
    assert.deepEqual(
      f.terminals,
      ["ordinary"],
      "execution lifecycle is not blocked by ordinary indexing",
    );
    f.syncer.disposeAll();
    release();
    await settle();
    assert.deepEqual(await f.index.listTaskMetas(scope), []);
    assert.deepEqual(f.events, []);
  } finally {
    release();
    await f.cleanup();
  }
});
