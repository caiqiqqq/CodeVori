import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7, type WorkTask } from "@zcode/shared";
import {
  conversationSnapshotSchema,
  encodeTopicWireFrames,
  type CommandEnvelope,
  type ConversationSnapshot,
  type ConversationTelemetryFact,
  type ConversationTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IGitService } from "../src/git/git.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { createWorkTaskExecution } from "../src/work-task/workTaskExecution.js";

function snapshot(phase: ConversationSnapshot["control"]["phase"] = "draft"): ConversationSnapshot {
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: "session",
    logEpoch: "epoch",
    seq: 0,
    revision: 0,
    control: {
      phase,
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: Object.fromEntries(
      [
        "fork",
        "compact",
        "switchModelConfig",
        "setFollowupMode",
        "queueEdit",
        "sendQueuedNow",
        "pauseGoal",
        "resumeGoal",
      ].map((key) => [key, { allowed: true }]),
    ),
    inputRouting: { mode: "startNow" },
    config: { provider: "provider", model: "model", thought: "high", followupMode: "queue" },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  });
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("native command did not arrive");
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-native-"));
  const path = join(dir, "abcd", "project");
  await mkdir(path, { recursive: true });
  const calls: string[] = [];
  const commands: CommandEnvelope[] = [];
  const updates: unknown[] = [];
  const frames = new Emitter<ConversationTopicWireCandidate>();
  const facts = new Emitter<ConversationTelemetryFact>();
  const lifecycle = new Emitter<{ workspaceKey: string; state: string }>();
  const task: WorkTask = {
    id: uuidv7(),
    workspacePath: dir,
    title: "Feature",
    prompt: "Build",
    execution: {
      kind: "api",
      modelSelection: {
        providerId: "provider",
        modelId: "model",
        options: { reasoningLevel: "high" },
      },
      mode: "plan",
    },
    status: "preparing",
    archived: false,
    stopPending: false,
    runSeq: 1,
    runText: "Build",
    commandId: uuidv7(),
    sessionRequestId: uuidv7(),
    worktree: {
      rootPath: dir,
      path,
      projectPath: dir,
      branchName: "worktree/abcd",
      baseCommit: "abcdef",
    },
    createdAt: 1,
    updatedAt: 1,
  };
  const agent = {
    helloConversationV4: async () => {
      calls.push("hello");
      return { protocolVersion: 4 };
    },
    initializeConversationV4: async () => {
      calls.push("initialize");
    },
    onDynamicConversationTelemetryFact: () => facts.event,
    onDynamicConversationFrame: () => frames.event,
    onAgentRuntimeLifecycle: lifecycle.event,
    subscribeConversationV4: async () => {
      calls.push("subscribe");
      return { ack: { subscriptionId: "sub", mode: "snapshot", logEpoch: "epoch" } };
    },
    sendConversationCommandV4: async ({ envelope }: { envelope: CommandEnvelope }) => {
      calls.push(envelope.type);
      commands.push(envelope);
      return {
        commandId: envelope.commandId,
        status: "accepted",
        ...(envelope.type === "createSession"
          ? { result: { type: "createSession", sessionId: "session" } }
          : {}),
      };
    },
    resyncConversationV4: async () => {
      throw new Error("resync unavailable");
    },
  } as unknown as IZCodeAgentService;
  const git = {
    getWorkspaceRepositoryInfo: async () => ({
      kind: "linked-worktree",
      repoRoot: path,
      mainWorktreePath: dir,
      branchName: "worktree/abcd",
    }),
    listManagedWorktrees: async () => [
      { projectPath: dir, worktrees: [{ worktreePath: path, branchName: "worktree/abcd" }] },
    ],
  } as unknown as IGitService;
  const abort = new AbortController();
  const port = createWorkTaskExecution({
    git,
    agent,
    acp: {} as IAcpService,
    settings: {} as ISettingService,
    ensureWorkspaceSubscription: () => calls.push("index"),
    createNativeConnection: () => ({
      service: agent,
      setTransportFlowState: async () => {},
      dispose: async () => {
        calls.push("dispose");
      },
    }),
  });
  const execute = () =>
    port.execute(task, {
      signal: abort.signal,
      update: async (patch) => {
        updates.push(patch);
        if (patch.session) calls.push(`bound:${patch.session.id}`);
        return true;
      },
    });
  let ordinal = 0;
  const emit = (state: ConversationSnapshot) => {
    const frame = {
      topic: "conversation/session",
      subscriptionId: "sub",
      fromSeq: 0,
      toSeq: state.seq,
      sentAt: Date.now(),
      payload: { kind: "snapshot" as const, snapshot: state },
    };
    for (const wire of encodeTopicWireFrames(frame, {
      topic: frame.topic,
      subscriptionId: "sub",
      logicalFrameId: uuidv7(),
      logicalFrameOrdinal: ++ordinal,
      deliveryKind: ordinal === 1 ? "initial" : "online",
      measurePhysicalFrameBytes: () => 100,
    }))
      frames.fire(wire);
  };
  const terminal = (sourceCommandId = task.commandId) =>
    facts.fire({
      version: 1,
      eventId: uuidv7(),
      eventSeq: 1,
      occurredAt: Date.now(),
      sessionId: "session",
      sourceCommandId,
      kind: "turn.terminal",
      status: "success",
    });
  return {
    task,
    agent,
    calls,
    commands,
    updates,
    frames,
    lifecycle,
    abort,
    execute,
    emit,
    terminal,
    path,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test(
  "native execution binds before sending and waits for the authoritative initial snapshot",
  { timeout: 3000 },
  async () => {
    const f = await fixture();
    try {
      let complete = false;
      const run = f.execute().then(() => {
        complete = true;
      });
      await until(() => f.calls.includes("subscribe"));
      assert.equal(f.calls.includes("sendText"), false);
      f.emit(snapshot());
      await until(() => f.calls.includes("sendText"));
      assert.deepEqual(f.commands[0]?.payload, {
        workspaceId: f.path,
        config: {
          modelSelection: f.task.execution.kind === "api" ? f.task.execution.modelSelection : null,
          mode: "plan",
        },
      });
      assert.deepEqual(f.commands[1]?.payload, {
        text: "Build",
        modelSelection: f.task.execution.kind === "api" ? f.task.execution.modelSelection : null,
        mode: "plan",
        planEnabled: true,
      });
      assert.ok(f.calls.indexOf("bound:session") < f.calls.indexOf("sendText"));
      f.terminal("another-command");
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(complete, false);
      f.terminal();
      await run;
      assert.equal(f.calls.at(-1), "dispose");
    } finally {
      f.abort.abort();
      await f.cleanup();
    }
  },
);

for (const phase of ["running", "prewarming"] as const) {
  test(
    `native retry refuses an existing ${phase} session before sending`,
    { timeout: 3000 },
    async () => {
      const f = await fixture();
      try {
        f.task.session = { kind: "api", id: "session" };
        const run = f.execute();
        await until(() => f.calls.includes("subscribe"));
        f.emit(snapshot(phase));
        await assert.rejects(run, /session-busy/);
        assert.equal(f.calls.includes("sendText"), false);
        assert.equal(f.calls.includes("createSession"), false);
      } finally {
        f.abort.abort();
        await f.cleanup();
      }
    },
  );
}

test(
  "permission waiting is projected and cancellation uses the exact foreground execution",
  { timeout: 3000 },
  async () => {
    const f = await fixture();
    try {
      const run = f.execute();
      await until(() => f.calls.includes("subscribe"));
      f.emit(snapshot());
      await until(() => f.calls.includes("sendText"));
      const state = snapshot("running");
      state.control.activeWorks = [
        { kind: "primaryTurn", foregroundExecutionId: "foreground-owned", startedAt: Date.now() },
      ];
      state.pendingInteractions = [
        {
          interactionId: "permission",
          kind: "permission",
          anchorRowId: null,
          createdAt: Date.now(),
          payload: {
            kind: "permission",
            toolCallId: "tool",
            toolName: "Write",
            summary: "Write",
            detail: {},
            options: [],
          },
        },
      ];
      f.emit(state);
      await until(() =>
        f.updates.some((patch) => (patch as { status: string }).status === "awaiting_input"),
      );
      f.abort.abort();
      await assert.rejects(run, /canceled/);
      assert.deepEqual(f.commands.at(-1)?.payload, {
        expectedForegroundExecutionId: "foreground-owned",
      });
      assert.equal(f.commands.at(-1)?.type, "stop");
    } finally {
      f.abort.abort();
      await f.cleanup();
    }
  },
);

test(
  "runtime loss while waiting for the initial snapshot releases the task attachment",
  { timeout: 3000 },
  async () => {
    const f = await fixture();
    try {
      const run = f.execute();
      await until(() => f.calls.includes("subscribe"));
      f.lifecycle.fire({ workspaceKey: f.path, state: "unavailable" });
      await assert.rejects(run, /agent-disconnected/);
      assert.equal(f.calls.includes("sendText"), false);
      assert.equal(f.calls.at(-1), "dispose");
    } finally {
      f.abort.abort();
      await f.cleanup();
    }
  },
);

test("failed hello still disposes the native attachment", async () => {
  const f = await fixture();
  try {
    f.agent.helloConversationV4 = async () => {
      throw new Error("hello failed");
    };
    await assert.rejects(f.execute(), /hello failed/);
    assert.equal(f.calls.at(-1), "dispose");
  } finally {
    f.abort.abort();
    await f.cleanup();
  }
});

test("cancel before the initial snapshot does not prompt or stop a different execution", async () => {
  const f = await fixture();
  try {
    const run = f.execute();
    await until(() => f.calls.includes("subscribe"));
    f.abort.abort();
    await assert.rejects(run, /canceled/);
    assert.equal(f.calls.includes("sendText"), false);
    assert.equal(f.calls.includes("stop"), false);
    assert.equal(f.calls.at(-1), "dispose");
  } finally {
    f.abort.abort();
    await f.cleanup();
  }
});

test("failed resync before the initial snapshot releases its waiting attachment", async () => {
  const f = await fixture();
  try {
    const run = f.execute();
    await until(() => f.calls.includes("subscribe"));
    const frame = {
      topic: "conversation/session",
      subscriptionId: "sub",
      fromSeq: 0,
      toSeq: 1,
      sentAt: Date.now(),
      payload: { kind: "deltas" as const, deltas: [] },
    };
    for (const wire of encodeTopicWireFrames(frame, {
      topic: frame.topic,
      subscriptionId: "sub",
      logicalFrameId: uuidv7(),
      logicalFrameOrdinal: 1,
      deliveryKind: "initial",
      measurePhysicalFrameBytes: () => 100,
    }))
      f.frames.fire(wire);
    await assert.rejects(run, /resync unavailable/);
    assert.equal(f.calls.includes("sendText"), false);
    assert.equal(f.calls.at(-1), "dispose");
  } finally {
    f.abort.abort();
    await f.cleanup();
  }
});

test("a snapshot with another inner session id is rejected before prompt", async () => {
  const f = await fixture();
  try {
    const run = f.execute();
    await until(() => f.calls.includes("subscribe"));
    const wrongSession = snapshot();
    wrongSession.sessionId = "different-session";
    f.emit(wrongSession);
    await assert.rejects(run, /snapshot-invalid/);
    assert.equal(f.calls.includes("sendText"), false);
    assert.equal(f.calls.at(-1), "dispose");
  } finally {
    f.abort.abort();
    await f.cleanup();
  }
});

test("stop rejection reports the runtime failure rather than successful cancellation", async () => {
  const f = await fixture();
  try {
    const send = f.agent.sendConversationCommandV4;
    f.agent.sendConversationCommandV4 = async (input) => {
      const ack = await send(input);
      return input.envelope.type === "stop"
        ? { commandId: input.envelope.commandId, status: "rejected", message: "Stop refused" }
        : ack;
    };
    const run = f.execute();
    await until(() => f.calls.includes("subscribe"));
    f.emit(snapshot());
    await until(() => f.calls.includes("sendText"));
    const active = snapshot("running");
    active.control.activeWorks = [
      { kind: "primaryTurn", foregroundExecutionId: "owned-turn", startedAt: Date.now() },
    ];
    f.emit(active);
    f.abort.abort();
    await assert.rejects(run, /Stop refused/);
    assert.equal(f.commands.at(-1)?.type, "stop");
    assert.equal(f.calls.at(-1), "dispose");
  } finally {
    f.abort.abort();
    await f.cleanup();
  }
});
