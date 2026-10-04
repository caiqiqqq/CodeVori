import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7, type WorkTask, type AcpSessionChanged } from "@zcode/shared";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IGitService } from "../src/git/git.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import type { ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import { createWorkTaskExecution } from "../src/work-task/workTaskExecution.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-adapter-"));
  const path = join(dir, "abcd", "project");
  await mkdir(path, { recursive: true });
  const calls: string[] = [];
  const changed = new Emitter<AcpSessionChanged>();
  const telemetry = new Emitter<ConversationTelemetryFact>();
  const worktree = {
    rootPath: dir,
    path,
    projectPath: "/project",
    branchName: "worktree/abcd",
    baseCommit: "abcdef",
  };
  const task: WorkTask = {
    id: uuidv7(),
    workspacePath: "/project",
    title: "Feature",
    prompt: "Build",
    execution: {
      kind: "acp",
      agent: "codex",
      config: [
        { configId: "model", value: "codex-model" },
        { configId: "reasoning", value: "high" },
      ],
    },
    status: "preparing",
    archived: false,
    stopPending: false,
    runSeq: 1,
    runText: "Build",
    commandId: uuidv7(),
    sessionRequestId: uuidv7(),
    worktree,
    createdAt: 1,
    updatedAt: 1,
  };
  const acp = {
    create: async () => {
      calls.push("create");
      return { id: "session", status: "idle" };
    },
    setConfigOption: async (input: { configId: string; value: string }) => {
      calls.push(`config:${input.configId}:${input.value}`);
    },
    prompt: async (input: { commandId: string; text: string }) => {
      calls.push(`prompt:${input.commandId}:${input.text}`);
      return { status: "idle" };
    },
    stop: async () => {
      calls.push("stop");
    },
    onDynamicSessionChanged: () => changed.event,
  } as unknown as IAcpService;
  const git = {
    getWorkspaceRepositoryInfo: async () => ({
      kind: "linked-worktree",
      repoRoot: path,
      mainWorktreePath: "/project",
      branchName: worktree.branchName,
    }),
    listManagedWorktrees: async () => [
      {
        projectPath: "/project",
        worktrees: [{ worktreePath: path, branchName: worktree.branchName }],
      },
    ],
  } as unknown as IGitService;
  const agent = {
    helloConversationV4: async () => ({ protocolVersion: 4 }),
    initializeConversationV4: async () => {},
    onDynamicConversationTelemetryFact: () => telemetry.event,
    onDynamicConversationFrame: () => new Emitter().event,
    subscribeConversationV4: async () => ({ ack: { subscriptionId: "sub" } }),
    sendConversationCommandV4: async () => {},
  } as unknown as IZCodeAgentService;
  return {
    dir,
    task,
    calls,
    acp,
    git,
    agent,
    telemetry,
    changed,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("ACP applies saved agent options and persists session before prompting", async () => {
  const f = await setup();
  try {
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    await port.execute(f.task, {
      signal: new AbortController().signal,
      update: async (patch) => {
        if (patch.session) f.calls.push(`bound:${patch.session.id}`);
        return true;
      },
    });
    assert.deepEqual(f.calls, [
      "create",
      "bound:session",
      "config:model:codex-model",
      "config:reasoning:high",
      `prompt:${f.task.commandId}:Build`,
    ]);
  } finally {
    await f.cleanup();
  }
});

test("lost ownership after ACP create never sends a prompt", async () => {
  const f = await setup();
  try {
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    await assert.rejects(
      port.execute(f.task, { signal: new AbortController().signal, update: async () => false }),
    );
    assert.equal(
      f.calls.some((call) => call.startsWith("prompt:")),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("ACP defaults do not write configuration and unsupported choices fail before prompting", async () => {
  const f = await setup();
  try {
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    assert.equal(f.task.execution.kind, "acp");
    f.task.execution = { kind: "acp", agent: "codex", config: [] };
    const context = {
      signal: new AbortController().signal,
      update: async () => true,
    };
    await port.execute(f.task, context);
    assert.deepEqual(f.calls, ["create", `prompt:${f.task.commandId}:Build`]);
    f.calls.length = 0;
    f.task.execution.config = [{ configId: "removed-model", value: "old-model" }];
    f.acp.setConfigOption = async () => {
      throw new Error("ACP config option is not available");
    };
    await assert.rejects(port.execute(f.task, context), /not available/);
    assert.deepEqual(f.calls, ["create"]);
  } finally {
    await f.cleanup();
  }
});

test("unrelated worktree directory is refused without connecting an agent", async () => {
  const f = await setup();
  try {
    f.git.getWorkspaceRepositoryInfo = async () => ({
      workspacePath: f.task.worktree!.path,
      kind: "main-tree",
      isGitAvailable: true,
      repoRoot: f.task.worktree!.path,
    });
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    await assert.rejects(
      port.execute(f.task, { signal: new AbortController().signal, update: async () => true }),
      /worktree-mismatch/,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    await f.cleanup();
  }
});

test("ACP retry refuses a busy bound session without configuring or prompting", async () => {
  const f = await setup();
  try {
    f.task.session = { kind: "acp", id: "session" };
    f.acp.list = async () =>
      [{ id: "session", agent: "codex", status: "running" }] as Awaited<
        ReturnType<IAcpService["list"]>
      >;
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    await assert.rejects(
      port.execute(f.task, { signal: new AbortController().signal, update: async () => true }),
      /session-busy/,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    await f.cleanup();
  }
});

test("ACP permission events are scoped and cancel stops the bound prompt", async () => {
  const f = await setup();
  const abort = new AbortController();
  let started!: () => void;
  const prompting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const states: string[] = [];
  try {
    f.acp.prompt = async () => {
      started();
      return new Promise(() => {});
    };
    const port = createWorkTaskExecution({
      git: f.git,
      acp: f.acp,
      agent: f.agent,
      settings: {} as ISettingService,
      ensureWorkspaceSubscription: () => {},
    });
    const run = port.execute(f.task, {
      signal: abort.signal,
      update: async (patch) => {
        if (patch.status) states.push(patch.status);
        return true;
      },
    });
    await prompting;
    f.changed.fire({
      kind: "updated",
      session: { id: "other", status: "running", pendingPermission: {} },
    } as AcpSessionChanged);
    assert.deepEqual(states, ["running"]);
    f.changed.fire({
      kind: "updated",
      session: { id: "session", status: "running", pendingPermission: {} },
    } as AcpSessionChanged);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(states.at(-1), "awaiting_input");
    f.changed.fire({
      kind: "updated",
      session: { id: "session", status: "running", pendingPermission: null },
    } as AcpSessionChanged);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(states.at(-1), "running");
    abort.abort();
    await assert.rejects(run, /canceled/);
    assert.equal(f.calls.at(-1), "stop");
  } finally {
    abort.abort();
    await f.cleanup();
  }
});
