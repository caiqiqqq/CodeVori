import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7, type AcpSessionChanged, type WorkTask } from "@zcode/shared";
import {
  conversationSnapshotSchema,
  encodeTopicWireFrames,
  type CommandEnvelope,
  type ConversationSnapshot,
  type ConversationTelemetryFact,
  type ConversationTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import type { IAcpService } from "../src/acp/acpService.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import type { WorkTaskExecutionUpdate } from "../src/session/contract.js";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createWorkTaskMerge } from "../src/work-task/workTaskMerge.js";

const execute = promisify(execFile);

function idleSnapshot(sessionId: string): ConversationSnapshot {
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId,
    logEpoch: "epoch",
    seq: 0,
    revision: 0,
    control: {
      phase: "draft",
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
    config: {
      provider: "saved-provider",
      model: "saved-model",
      thought: "high",
      followupMode: "queue",
    },
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

async function fixture(kind: "api" | "acp", conflict = true) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-merge-execution-"));
  const project = join(directory, "project");
  const rootPath = join(directory, "trees");
  const sourcePath = join(rootPath, "task", "project");
  await mkdir(project);
  const git = async (args: string[], cwd = project) =>
    (await execute("git", ["-C", cwd, ...args])).stdout.trim();
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "Resolver Test"]);
  await git(["config", "user.email", "resolver@example.invalid"]);
  await writeFile(join(project, "file.txt"), "base\n");
  await git(["add", "."]);
  await git(["commit", "-qm", "Base"]);
  const baseCommit = await git(["rev-parse", "HEAD"]);
  await git(["worktree", "add", "-qb", "worktree/task", sourcePath]);
  await writeFile(join(sourcePath, conflict ? "file.txt" : "task.txt"), "source\n");
  await writeFile(join(project, "file.txt"), "target\n");
  await git(["commit", "-qam", "Target"]);
  const targetCommit = await git(["rev-parse", "HEAD"]);
  let task: WorkTask = {
    id: uuidv7(),
    workspacePath: project,
    title: "Saved task",
    prompt: "Keep both intended changes",
    execution:
      kind === "api"
        ? {
            kind,
            modelSelection: {
              providerId: "saved-provider",
              modelId: "saved-model",
              options: { reasoningLevel: "high" },
            },
            mode: "edit",
          }
        : {
            kind,
            agent: "codex",
            config: [
              { configId: "model", value: "saved-codex" },
              { configId: "fast", value: false },
            ],
          },
    sourceBranch: "main",
    status: "preparing",
    archived: false,
    stopPending: false,
    runSeq: 2,
    runText: "Original task",
    commandId: uuidv7(),
    sessionRequestId: uuidv7(),
    session: { kind, id: "original" },
    worktree: {
      rootPath,
      path: sourcePath,
      projectPath: project,
      branchName: "worktree/task",
      baseCommit,
    },
    merge: { id: uuidv7(), projectPath: project, targetBranch: "main", phase: "queued" },
    attachments: [
      {
        ref: join(directory, "original.bin"),
        fileName: "original.bin",
        mime: "application/octet-stream",
        bytes: 1,
      },
    ],
    workspaceFiles: ["file.txt"],
    createdAt: 1,
    updatedAt: 1,
  };
  const calls: { op: string; input?: unknown }[] = [];
  const updates: WorkTaskExecutionUpdate[] = [];
  const control = {
    failResolver: false,
    busyResolver: false,
    staleSourceSnapshot: false,
    waitResolver: false,
    resolverStarted: false,
    resolverBackground: undefined as
      | ConversationSnapshot["backgroundWorks"][number]["status"]
      | undefined,
    resolverPendingCommand: false,
  };
  const abort = new AbortController();
  const acpEvents = new Emitter<AcpSessionChanged>();
  const resolveConflict = async () => {
    control.resolverStarted = true;
    if (control.failResolver) throw new Error("Synthetic resolver failure");
    assert.equal(task.session?.id, "original");
    assert.equal(
      task.merge?.session?.id,
      "resolver",
      "resolver binding must be saved before prompting",
    );
    assert.ok(task.merge?.worktree);
    await writeFile(join(task.merge.worktree.path, "file.txt"), "source and target\n");
  };
  const acp = {
    list: async (input: { workspacePath: string }) => {
      calls.push({ op: "acp-list", input });
      const resolver = input.workspacePath !== sourcePath;
      return [
        {
          id: resolver ? "resolver" : "original",
          agent: "codex",
          status: resolver && control.busyResolver ? "running" : "idle",
        },
      ];
    },
    create: async (input: unknown) => {
      calls.push({ op: "acp-create", input });
      return { id: "resolver" };
    },
    setConfigOption: async (input: unknown) => {
      calls.push({ op: "acp-config", input });
    },
    prompt: async (input: unknown) => {
      calls.push({ op: "acp-prompt", input });
      if (control.waitResolver) {
        control.resolverStarted = true;
        return new Promise(() => {});
      }
      await resolveConflict();
      return { id: "resolver", status: "idle" };
    },
    stop: async (input: unknown) => {
      calls.push({ op: "acp-stop", input });
    },
    onDynamicSessionChanged: () => acpEvents.event,
  } as unknown as IAcpService;
  const createNativeConnection = (conversation: WorkTask) => {
    calls.push({
      op: "api-connect",
      input: { session: conversation.session?.id, workspacePath: conversation.worktree?.path },
    });
    const frames = new Emitter<ConversationTopicWireCandidate>();
    const facts = new Emitter<ConversationTelemetryFact>();
    const subscriptionId = uuidv7();
    let ordinal = 0;
    const emit = (state: ConversationSnapshot, sub = subscriptionId) => {
      const topic = `conversation/${state.sessionId}`;
      for (const wire of encodeTopicWireFrames(
        {
          topic,
          subscriptionId: sub,
          fromSeq: 0,
          toSeq: 0,
          sentAt: Date.now(),
          payload: { kind: "snapshot", snapshot: state },
        },
        {
          topic,
          subscriptionId: sub,
          logicalFrameId: uuidv7(),
          logicalFrameOrdinal: ++ordinal,
          deliveryKind: "initial",
          measurePhysicalFrameBytes: () => 100,
        },
      ))
        frames.fire(wire);
    };
    const agent = {
      helloConversationV4: async () => ({ protocolVersion: 4 }),
      initializeConversationV4: async () => {},
      onDynamicConversationFrame: () => frames.event,
      onDynamicConversationTelemetryFact: () => facts.event,
      subscribeConversationV4: async (input: { sessionId: string }) => {
        const state = idleSnapshot(input.sessionId);
        if (input.sessionId === "original" && control.staleSourceSnapshot) {
          emit(state, "stale-subscription");
          state.control.phase = "running";
        }
        if (input.sessionId === "resolver" && conversation.session && control.busyResolver)
          state.control.phase = "running";
        if (input.sessionId === "resolver" && conversation.session && control.resolverBackground)
          state.backgroundWorks = [
            {
              workId: "background",
              kind: "bash",
              title: "Background check",
              status: control.resolverBackground,
              startedAt: 1,
              anchorRowId: null,
            },
          ];
        if (
          input.sessionId === "resolver" &&
          conversation.session &&
          control.resolverPendingCommand
        )
          state.pendingCommands = [
            { commandId: "queued", clientId: "other", type: "sendText", state: "accepted", at: 1 },
          ];
        // Deliberately arrive before the ACK to exercise exact subscription filtering.
        emit(state);
        return { ack: { subscriptionId, mode: "snapshot", logEpoch: "epoch" } };
      },
      sendConversationCommandV4: async (input: { envelope: CommandEnvelope }) => {
        calls.push({ op: `api-${input.envelope.type}`, input: input.envelope });
        if (input.envelope.type === "createSession")
          return { status: "accepted", result: { type: "createSession", sessionId: "resolver" } };
        if (input.envelope.type === "sendText") {
          if (control.waitResolver) {
            const state = idleSnapshot("resolver");
            state.control.phase = "running";
            state.control.activeWorks = [
              { kind: "primaryTurn", foregroundExecutionId: "resolver-owned", startedAt: 1 },
            ];
            emit(state);
            control.resolverStarted = true;
            return { status: "accepted" };
          }
          await resolveConflict();
          facts.fire({
            version: 1,
            eventId: uuidv7(),
            eventSeq: 1,
            occurredAt: Date.now(),
            sessionId: "resolver",
            sourceCommandId: task.commandId,
            kind: "turn.terminal",
            status: "success",
          });
        }
        return { status: "accepted" };
      },
    } as unknown as IZCodeAgentService;
    return {
      service: agent,
      setTransportFlowState: async () => {},
      dispose: async () => {
        frames.dispose();
        facts.dispose();
        calls.push({ op: "api-dispose" });
      },
    };
  };
  const service = createGitService({ repo: createGitCliRepo() });
  const port = createWorkTaskMerge({
    git: {
      ...service,
      async finalizeTaskMerge(input) {
        calls.push({ op: "git-finalize" });
        return service.finalizeTaskMerge(input);
      },
      async applyTaskMerge(input) {
        calls.push({ op: "git-publish" });
        return service.applyTaskMerge(input);
      },
    },
    settings: {} as ISettingService,
    acp,
    agent: {} as IZCodeAgentService,
    createNativeConnection,
    homeDirectory: directory,
    ensureWorkspaceSubscription: () => {},
  });
  return {
    get task() {
      return task;
    },
    calls,
    control,
    targetCommit,
    project,
    git,
    abort,
    async run() {
      await port.execute(task, {
        signal: abort.signal,
        update: async (patch) => {
          updates.push(patch);
          task = { ...task, ...patch };
          return !abort.signal.aborted;
        },
      });
    },
    async validate() {
      return port.validate(task, "main");
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

for (const kind of ["api", "acp"] as const) {
  test(`${kind} conflicts reuse saved settings, preserve the original session and publish only after idle validation`, async () => {
    const f = await fixture(kind);
    try {
      await f.validate();
      assert.equal(f.calls.length, 0, "validation must not contact an Agent");
      await f.run();
      assert.equal(f.task.session?.id, "original");
      assert.equal(f.task.merge?.phase, "merged");
      assert.equal(await f.git(["rev-parse", "main"]), f.task.merge?.resultCommit);
      assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "source and target\n");
      const prompt = f.calls.find(
        (call) => call.op === (kind === "api" ? "api-sendText" : "acp-prompt"),
      )!.input as {
        payload?: { text: string; attachments?: unknown };
        text?: string;
        attachments?: unknown;
        workspaceFiles?: unknown;
      };
      assert.match(prompt.payload?.text ?? prompt.text ?? "", /Keep both intended changes/);
      assert.equal(f.calls.filter((call) => call.op === "git-publish").length, 1);
      if (kind === "acp") {
        assert.deepEqual(prompt.attachments, []);
        assert.deepEqual(prompt.workspaceFiles, []);
        const config = f.calls
          .filter((call) => call.op === "acp-config")
          .map((call) => call.input as { configId: string; value: string | boolean });
        assert.deepEqual(
          config.map(({ configId, value }) => ({ configId, value })),
          f.task.execution.kind === "acp" ? f.task.execution.config : [],
        );
        assert.equal(
          f.calls.find((call) => call.op === "acp-create")?.input &&
            (f.calls.find((call) => call.op === "acp-create")!.input as { requestId: string })
              .requestId,
          f.task.merge?.id,
        );
      } else {
        assert.equal(prompt.payload?.attachments, undefined);
        assert.deepEqual(
          (prompt as unknown as { payload: { modelSelection: unknown; mode: string } }).payload
            .modelSelection,
          f.task.execution.kind === "api" ? f.task.execution.modelSelection : null,
        );
        assert.equal((prompt as unknown as { payload: { mode: string } }).payload.mode, "edit");
      }
    } finally {
      await f.cleanup();
    }
  });

  test(`${kind} no-conflict merges do not create or prompt a resolver`, async () => {
    const f = await fixture(kind, false);
    try {
      await f.run();
      assert.equal(f.task.merge?.phase, "merged");
      assert.equal(f.task.merge?.session, undefined);
      assert.equal(
        f.calls.some((call) => /(?:create|createSession|prompt|sendText)/.test(call.op)),
        false,
      );
    } finally {
      await f.cleanup();
    }
  });

  for (const condition of ["failResolver", "busyResolver"] as const) {
    test(`${kind} ${condition} leaves the target unchanged and retains both bindings`, async () => {
      const f = await fixture(kind);
      try {
        f.control[condition] = true;
        await assert.rejects(
          f.run(),
          condition === "failResolver" ? /Synthetic resolver failure/ : /work-task.session-busy/,
        );
        assert.equal(await f.git(["rev-parse", "main"]), f.targetCommit);
        assert.equal(f.task.session?.id, "original");
        assert.equal(f.task.merge?.session?.id, "resolver");
        assert.equal(
          f.calls.some((call) => call.op === "git-publish"),
          false,
        );
        assert.equal(
          f.calls.some((call) => call.op === "git-finalize"),
          false,
        );
      } finally {
        await f.cleanup();
      }
    });
  }
}

test("API merge ignores stale idle snapshots received before its subscription ACK", async () => {
  const f = await fixture("api");
  try {
    f.control.staleSourceSnapshot = true;
    await assert.rejects(f.run(), /work-task.session-busy/);
    assert.equal(f.task.merge?.worktree, undefined);
    assert.equal(await f.git(["rev-parse", "main"]), f.targetCommit);
  } finally {
    await f.cleanup();
  }
});

for (const kind of ["api", "acp"] as const) {
  test(`${kind} merge cancellation stops only the owned resolver command and never publishes`, async () => {
    const f = await fixture(kind);
    try {
      f.control.waitResolver = true;
      const run = f.run();
      for (let i = 0; !f.control.resolverStarted && i < 200; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(f.control.resolverStarted);
      f.abort.abort();
      await assert.rejects(run, /work-task.canceled/);
      const stop = f.calls.find((call) => call.op === `${kind}-stop`)!.input as {
        id: string;
        expectedCommandId: string;
        workspacePath: string;
        payload: { expectedForegroundExecutionId: string };
        sessionId: string;
      };
      if (kind === "acp") {
        assert.equal(stop.id, "resolver");
        assert.equal(stop.expectedCommandId, f.task.commandId);
        assert.equal(stop.workspacePath, f.task.merge?.worktree?.path);
      } else {
        assert.equal(stop.sessionId, "resolver");
        assert.equal(stop.payload.expectedForegroundExecutionId, "resolver-owned");
      }
      assert.equal(
        f.calls.some((call) => call.op === "git-publish"),
        false,
      );
      assert.equal(await f.git(["rev-parse", "main"]), f.targetCommit);
    } finally {
      f.abort.abort();
      await f.cleanup();
    }
  });
}

for (const status of ["running", "resultPending", "failed", "cancelled"] as const) {
  test(`API resolver background ${status} is checked before publication`, async () => {
    const f = await fixture("api");
    try {
      f.control.resolverBackground = status;
      if (status === "running" || status === "resultPending") {
        await assert.rejects(f.run(), /work-task.session-busy/);
        assert.equal(await f.git(["rev-parse", "main"]), f.targetCommit);
        assert.equal(
          f.calls.some((call) => call.op === "git-publish"),
          false,
        );
      } else {
        await f.run();
        assert.equal(f.task.merge?.phase, "merged");
      }
    } finally {
      await f.cleanup();
    }
  });
}

test("API resolver pending commands prevent publishing an otherwise idle foreground", async () => {
  const f = await fixture("api");
  try {
    f.control.resolverPendingCommand = true;
    await assert.rejects(f.run(), /work-task.session-busy/);
    assert.equal(await f.git(["rev-parse", "main"]), f.targetCommit);
    assert.equal(
      f.calls.some((call) => call.op === "git-publish"),
      false,
    );
  } finally {
    await f.cleanup();
  }
});
