import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, workTaskSchema, type AcpSession, type WorkTask } from "@zcode/shared";
import { openWorkTaskDatabase } from "../src/session/workTaskDatabase.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";
import { executeWorkTaskConversation } from "../src/work-task/workTaskExecution.js";

const tree = (path: string) => ({
  rootPath: "/trees",
  path,
  projectPath: "/project",
  branchName: "task/test",
  baseCommit: "base",
});
function task(kind: "api" | "acp", patch: Partial<WorkTask> = {}): WorkTask {
  return workTaskSchema.parse({
    id: uuidv7(),
    workspacePath: "/project",
    title: "Owned task",
    prompt: "Instructions",
    execution:
      kind === "api"
        ? { kind, modelSelection: { providerId: "test", modelId: "test" }, mode: "build" }
        : { kind, agent: "codex", config: [] },
    status: "review",
    archived: false,
    runSeq: 1,
    runText: "Instructions",
    commandId: uuidv7(),
    sessionRequestId: uuidv7(),
    session: { kind, id: "execution" },
    worktree: tree("/trees/task"),
    merge: {
      id: uuidv7(),
      projectPath: "/project",
      targetBranch: "main",
      phase: "failed",
      session: { kind, id: "merge" },
      worktree: tree("/trees/merge"),
    },
    stopPending: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}
async function fixture(tasks: WorkTask[]) {
  const directory = await mkdtemp(join(tmpdir(), "work-task-visibility-"));
  const path = join(directory, "work-tasks.sqlite");
  const db = await openWorkTaskDatabase(path);
  for (const item of tasks)
    db.prepare("INSERT INTO work_tasks(id,workspace_key,status,data) VALUES(?,?,?,?)").run(
      item.id,
      item.workspaceIdentity?.trim() || item.workspacePath,
      item.status,
      JSON.stringify(item),
    );
  db.close();
  const repo = new WorkTaskRepo(path);
  await repo.ready();
  return {
    directory,
    path,
    repo,
    async cleanup() {
      repo.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("durable execution/merge membership survives reopening and respects scope, kind and lifecycle", async () => {
  const f = await fixture([
    task("acp", { status: "done", archived: true }),
    task("api", {
      useWorktree: false,
      directBranch: "feature",
      worktree: undefined,
      merge: undefined,
    }),
    task("acp", {
      workspaceIdentity: "remote-one",
      session: { kind: "acp", id: "remote" },
      merge: undefined,
    }),
    task("acp", { status: "canceled", session: { kind: "acp", id: "canceled" }, merge: undefined }),
    task("acp", { session: undefined, merge: undefined }),
  ]);
  try {
    assert.deepEqual(
      f.repo.conversationSessionIds({ workspacePath: "/trees/task" }, "acp").sort(),
      ["canceled", "execution"],
    );
    assert.deepEqual(f.repo.conversationSessionIds({ workspacePath: "/trees/merge" }, "acp"), [
      "merge",
    ]);
    assert.deepEqual(f.repo.conversationSessionIds({ workspacePath: "/project" }, "api"), [
      "execution",
    ]);
    assert.deepEqual(f.repo.conversationSessionIds({ workspacePath: "/project" }, "acp"), []);
    assert.deepEqual(
      f.repo.conversationSessionIds(
        { workspacePath: "/trees/task", workspaceIdentity: "remote-one" },
        "acp",
      ),
      ["remote"],
    );
    assert.deepEqual(
      f.repo.conversationSessionIds(
        { workspacePath: "/trees/task", workspaceIdentity: "remote-two" },
        "acp",
      ),
      [],
    );
    const reopened = new WorkTaskRepo(f.path);
    await reopened.ready();
    try {
      assert.deepEqual(reopened.conversationSessionIds({ workspacePath: "/trees/merge" }, "acp"), [
        "merge",
      ]);
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("API task ownership is filtered before ordinary/pinned/archived search pagination", async () => {
  const f = await fixture([task("api", { worktree: tree("/project"), merge: undefined })]);
  const index = new TaskIndexRepo(join(f.directory, "index.sqlite"));
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const noop = () => ({ dispose() {} });
  const service = createZCodeTaskServiceAdapter({
    taskIndexRepo: index,
    zcodeAgentService: { disposeAll() {} } as Options["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: noop,
      onSessionReadyEvent: noop,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    hiddenSessionIds: async (scope) => f.repo.conversationSessionIds(scope, "api"),
  });
  try {
    for (const [taskId, workspaceIdentity, updatedAt] of [
      ["execution", undefined, 30],
      ["ordinary", undefined, 20],
      ["execution", "other-host", 10],
    ] as const)
      await index.syncTaskMeta({
        meta: {
          workspacePath: "/project",
          workspaceIdentity,
          taskId,
          traceId: taskId,
          title: "matching",
          mode: "build",
          provider: "glm",
          createdAt: updatedAt,
          updatedAt,
        },
      });
    assert.deepEqual(
      (await service.listTasks({ workspacePath: "/project" })).map((x) => x.taskId),
      ["ordinary"],
    );
    const result = await service.listTaskList({
      kind: "timeline",
      workspaceScopes: [
        { workspacePath: "/project" },
        { workspacePath: "/project", workspaceIdentity: "other-host" },
      ],
      search: "matching",
      sortBy: "updated",
      limit: 2,
    });
    assert.deepEqual(
      result.items.map((x) => [x.workspaceIdentity, x.taskId]),
      [
        [undefined, "ordinary"],
        ["other-host", "execution"],
      ],
    );
    assert.equal(result.total, 2);
    assert.equal(result.hasMore, false);
    const meta = {
      workspacePath: "/project",
      taskId: "execution",
      traceId: "execution",
      title: "matching",
      mode: "build" as const,
      provider: "glm" as const,
      createdAt: 30,
      updatedAt: 30,
    };
    await index.syncTaskMeta({ meta, pinned: true });
    assert.deepEqual(await service.listPinnedTasks({ workspacePath: "/project" }), []);
    assert.deepEqual(await service.listPinnedTaskIds(), []);
    await index.syncTaskMeta({ meta, pinned: false, archived: true });
    assert.deepEqual(await service.listArchivedTasks({ workspacePath: "/project" }), []);
    assert.deepEqual(await service.listArchivedWorkspaces(), []);
    assert.equal(
      (await index.listTaskMetas({ workspacePath: "/project", archived: true })).length,
      1,
      "history remains stored",
    );
  } finally {
    service.disposeAll();
    index.close();
    await f.cleanup();
  }
});

test("ACP owned sessions leave summaries, dynamic rows and search but stay directly readable", async () => {
  const ownedId = uuidv7(),
    ordinaryId = uuidv7();
  const f = await fixture([task("acp", { session: { kind: "acp", id: ownedId } })]);
  const service = createAcpService({
    directory: f.directory,
    hiddenSessionIds: async (scope) => f.repo.conversationSessionIds(scope, "acp"),
  });
  const changes: string[] = [];
  const target = { workspacePath: "/trees/task" };
  const sub = service.onDynamicSessionSummaryChanged(target)((change) => {
    if (change.kind === "updated") changes.push(change.session.id);
  });
  const snapshot = (id: string): AcpSession => ({
    ...target,
    id,
    agent: "codex",
    acpSessionId: id,
    title: "matching",
    status: "idle",
    revision: 1,
    archived: false,
    pinned: false,
    unreadAt: null,
    goal: null,
    configOptions: [],
    modeState: null,
    pendingPermission: null,
    error: null,
    entries: [{ id: "user:" + id, kind: "user", text: "matching", createdAt: 1 }],
  });
  try {
    for (const id of [ownedId, ordinaryId])
      await writeFile(join(f.directory, `${id}.json`), JSON.stringify(snapshot(id)));
    assert.deepEqual(
      (await service.listSummaries(target)).map((x) => x.id),
      [ordinaryId],
    );
    assert.deepEqual(
      (await service.search({ ...target, query: "matching", limit: 1 })).map((x) => x.id),
      [ordinaryId],
    );
    assert.equal((await service.read({ ...target, id: ownedId })).entries[0]?.text, "matching");
    assert.equal((await service.list(target)).length, 2);
    await service.updateRow({
      ...target,
      id: ownedId,
      action: { kind: "rename", title: "Owned renamed" },
    });
    await service.updateRow({
      ...target,
      id: ordinaryId,
      action: { kind: "rename", title: "Ordinary renamed" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(changes.includes(ordinaryId));
    assert.ok(!changes.includes(ownedId), "dynamic updates must not resurrect owned rows");
    await service.updateRow({
      ...target,
      id: ownedId,
      action: { kind: "archive", archived: true },
    });
    assert.deepEqual(await service.listArchivedWorkspaces(), []);
  } finally {
    sub.dispose();
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});

test("ACP creation, durable task binding and first prompt never publish an ordinary conversation", async () => {
  const f = await fixture([]);
  const target = { workspacePath: "/project" };
  let promptBinding: string[] = [];
  const service = createAcpService({
    directory: f.directory,
    hiddenSessionIds: async (scope) => f.repo.conversationSessionIds(scope, "acp"),
    connect: async ({ sessionId }) => ({
      sessionId: sessionId ?? "native-task",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        promptBinding = f.repo.conversationSessionIds(target, "acp");
      },
      async cancel() {},
      close() {},
    }),
  });
  const ordinary: string[] = [];
  const internal: string[] = [];
  const rowSub = service.onDynamicSessionSummaryChanged(target)((change) => {
    if (change.kind === "updated") ordinary.push(change.session.id);
  });
  const rawSub = service.onDynamicSessionChanged(target)((change) => {
    if (change.kind === "updated" && change.session.entries.some((row) => row.kind === "user"))
      internal.push(change.session.id);
  });
  const create = service.create.bind(service);
  let duringCreation: string[] = [];
  service.create = async (input) => {
    const session = await create(input);
    // 复现真实 RPC 空档：底层 create 已返回，但执行器尚未提交 WorkTaskRepo 绑定。
    assert.deepEqual(f.repo.conversationSessionIds(target, "acp"), []);
    duringCreation = (await service.listSummaries(target)).map((row) => row.id);
    return session;
  };
  try {
    const draft = f.repo.create({
      ...target,
      title: "Feature",
      prompt: "Build",
      sourceBranch: "main",
      useWorktree: false,
      execution: { kind: "acp", agent: "codex", config: [] },
    });
    f.repo.enqueue(target, draft.id);
    const run = f.repo.claimNext("owner", Date.now(), 60_000)!;
    assert.ok(f.repo.updateRun(run, "owner", { directBranch: "main" }));
    type Deps = Parameters<typeof executeWorkTaskConversation>[0];
    await executeWorkTaskConversation(
      { acp: service } as Deps,
      run,
      {
        signal: new AbortController().signal,
        update: async (patch) => f.repo.updateRun(run, "owner", patch),
      },
      target.workspacePath,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const bound = f.repo.get(target, draft.id).session!;
    assert.deepEqual(
      duringCreation,
      [],
      "connected empty session is not ordinary history before binding",
    );
    assert.deepEqual(promptBinding, [bound.id], "binding is committed before first prompt");
    assert.deepEqual(ordinary, [], "neither create nor prompt may register an ordinary row");
    assert.ok(
      internal.includes(bound.id),
      "task execution still receives its full internal updates",
    );
    assert.deepEqual(await service.listSummaries(target), []);
    assert.equal((await service.read({ ...target, id: bound.id })).entries[0]?.kind, "user");
  } finally {
    rowSub.dispose();
    rawSub.dispose();
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});
