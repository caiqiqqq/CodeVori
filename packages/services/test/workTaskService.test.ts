import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import type { IWorkTaskService } from "../src/session/contract.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import type { WorkTaskExecutionContext } from "../src/session/workTask.js";
import type { WorkTask } from "@zcode/shared";

const workspace = { workspacePath: "/project" };
const draft = {
  ...workspace,
  title: "Test task",
  prompt: "Implement the feature",
  execution: {
    kind: "api" as const,
    modelSelection: { providerId: "test", modelId: "model" },
    mode: "build" as const,
  },
};

async function fixture(
  execute: (task: WorkTask, context: WorkTaskExecutionContext) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-work-tasks-"));
  const dbPath = join(directory, "work-tasks.sqlite");
  const services: WorkTaskService[] = [];
  const makeService = (options: { pollIntervalMs?: number; allowExecution?: boolean } = {}) => {
    const service = new WorkTaskService({
      repo: new WorkTaskRepo(dbPath),
      execute,
      pollIntervalMs: 20,
      ...options,
    });
    services.push(service);
    return service;
  };
  return {
    dbPath,
    makeService,
    async cleanup() {
      for (const service of services) await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("task state did not settle");
}

test("creating and editing only persist drafts, survive restart and isolate workspaces", async () => {
  let executions = 0;
  const f = await fixture(async () => {
    executions++;
  });
  try {
    const a = f.makeService();
    const task = await a.create(draft);
    await a.update({ ...draft, id: task.id, title: "Edited" });
    assert.equal(executions, 0);
    await assert.rejects(
      a.update({ ...draft, workspacePath: "/other", id: task.id }),
      /work-task.not-found/,
    );
    await a.disposeAllAndWait();
    const b = f.makeService();
    const board = await b.list(workspace);
    assert.equal(board.tasks[0]?.title, "Edited");
    assert.equal(board.tasks[0]?.status, "todo");
    assert.deepEqual((await b.list({ workspacePath: "/other" })).tasks, []);
  } finally {
    await f.cleanup();
  }
});

for (const kind of ["api", "acp"] as const) {
  test(`${kind} edited retry uses the new prompt and keeps its worktree and session`, async () => {
    const runs: WorkTask[] = [];
    const binding = { kind, id: "original-session" };
    const worktree = {
      rootPath: "/trees",
      path: "/trees/abcd/project",
      projectPath: workspace.workspacePath,
      branchName: "worktree/abcd",
      baseCommit: "abcdef",
    };
    const f = await fixture(async (task, context) => {
      runs.push(task);
      if (runs.length === 1) {
        await context.update({ session: binding, worktree });
        throw new Error("Synthetic first-run failure");
      }
    });
    try {
      const service = f.makeService();
      const execution =
        kind === "api"
          ? draft.execution
          : { kind, agent: "codex" as const, config: [{ configId: "fast", value: false }] };
      const task = await service.create({ ...draft, execution });
      await service.start({ ...workspace, id: task.id });
      await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "failed");
      const edited = await service.update({
        ...draft,
        id: task.id,
        title: "Edited retry",
        prompt: "Run the edited instructions",
        execution,
      });
      assert.equal(edited.runText, "Run the edited instructions");
      assert.equal(edited.status, "failed", "update alone must remain a save-only command");
      assert.deepEqual(edited.session, binding);
      assert.deepEqual(edited.worktree, worktree);
      await service.start({ ...workspace, id: task.id });
      await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "review");
      assert.equal(runs.length, 2);
      assert.equal(runs[1]?.id, task.id);
      assert.equal(runs[1]?.runSeq, 2);
      assert.equal(runs[1]?.runText, "Run the edited instructions");
      assert.deepEqual(runs[1]?.execution, execution);
      assert.deepEqual(runs[1]?.session, binding);
      assert.deepEqual(runs[1]?.worktree, worktree);
    } finally {
      await f.cleanup();
    }
  });
}

test("two Hosts claim each task once and share project concurrency", async () => {
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const f = await fixture(async (task) => {
    started.push(task.id);
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
  });
  try {
    const a = f.makeService();
    const b = f.makeService();
    const one = await a.create(draft);
    const two = await a.create({ ...draft, title: "Second" });
    await Promise.all([
      a.start({ ...workspace, id: one.id }),
      b.start({ ...workspace, id: one.id }),
    ]);
    await b.start({ ...workspace, id: two.id });
    await eventually(async () => started.length === 1);
    assert.equal((await a.list(workspace)).tasks.find((t) => t.id === two.id)?.status, "queued");
    releases.shift()?.();
    await eventually(async () => started.length === 2);
    releases.shift()?.();
    await eventually(async () =>
      (await a.list(workspace)).tasks.every((t) => t.status === "review"),
    );
    assert.equal(new Set(started).size, 2);
  } finally {
    releases.forEach((release) => release());
    await f.cleanup();
  }
});

test("cancel fences late results; retry uses a new run and retains the binding", async () => {
  const runs: { task: WorkTask; context: WorkTaskExecutionContext; release: () => void }[] = [];
  const f = await fixture(async (task, context) => {
    await context.update({
      session: { kind: "api", id: "owned-session" },
      worktree: {
        rootPath: "/trees",
        path: "/trees/abcd/project",
        branchName: "worktree/abcd",
        baseCommit: "abcdef",
        projectPath: "/project",
      },
    });
    await new Promise<void>((resolve) => {
      runs.push({ task, context, release: resolve });
    });
  });
  try {
    const service = f.makeService();
    const task = await service.create(draft);
    await service.start({ ...workspace, id: task.id });
    await eventually(async () => runs.length === 1);
    await service.cancel({ ...workspace, id: task.id });
    assert.equal(runs[0]?.context.signal.aborted, true);
    assert.equal(await runs[0]!.context.update({ status: "awaiting_input" }), false);
    runs[0]!.release();
    await eventually(async () => !(await service.list(workspace)).tasks[0]?.stopPending);
    assert.equal((await service.list(workspace)).tasks[0]?.status, "canceled");
    await service.start({ ...workspace, id: task.id });
    await eventually(async () => runs.length === 2);
    assert.equal(runs[1]?.task.runSeq, 2);
    assert.equal(runs[1]?.task.session?.id, "owned-session");
    assert.equal(await runs[0]!.context.update({ status: "running" }), false);
    runs[1]!.release();
    await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "review");
  } finally {
    runs.forEach((run) => run.release());
    await f.cleanup();
  }
});

test("review feedback reuses its conversation and acceptance does not run Git cleanup", async () => {
  const seen: WorkTask[] = [];
  const f = await fixture(async (task, context) => {
    seen.push(task);
    await context.update({ session: { kind: "api", id: "conversation" } });
  });
  try {
    const service = f.makeService();
    const task = await service.create(draft);
    await service.start({ ...workspace, id: task.id });
    await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "review");
    await assert.rejects(service.start({ ...workspace, id: task.id }), /feedback-required/);
    await service.start({ ...workspace, id: task.id, feedback: "Please add tests" });
    await eventually(
      async () =>
        seen.length === 2 && (await service.list(workspace)).tasks[0]?.status === "review",
    );
    assert.equal(seen[1]?.session?.id, "conversation");
    assert.equal(seen[1]?.runText, "Please add tests");
    const completed = await service.complete({ ...workspace, id: task.id });
    assert.equal(completed.completion, "accepted_without_merge");
    assert.equal(completed.session?.id, "conversation");
    await service.archive({ ...workspace, id: task.id, archived: true });
    assert.equal((await service.list(workspace)).tasks.length, 0);
    assert.equal((await service.list({ ...workspace, includeArchived: true })).tasks.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("recovery only fails expired leases, not another live Host", async () => {
  const f = await fixture(async () => {});
  const repo = new WorkTaskRepo(f.dbPath);
  try {
    const service = f.makeService();
    const live = await service.create(draft);
    const expired = await service.create({ ...draft, title: "Expired" });
    await repo.ready();
    repo.enqueue(workspace, live.id);
    repo.claimNext("other-window", Date.now(), 60_000);
    repo.enqueue(workspace, expired.id);
    repo.setConcurrency(workspace, 2);
    repo.claimNext("crashed-window", Date.now() - 60_000, 100);
    await service.list(workspace);
    const tasks = repo.list(workspace, true);
    assert.equal(tasks.find((task) => task.id === live.id)?.status, "preparing");
    await eventually(
      async () =>
        (await service.list(workspace)).tasks.find((task) => task.id === expired.id)?.status ===
        "failed",
    );
    assert.equal(
      repo.list(workspace, true).find((task) => task.id === expired.id)?.failureReason,
      "work-task.host-interrupted",
    );
  } finally {
    repo.close();
    await f.cleanup();
  }
});

test("invalid settings and remote execution fail before admission", async () => {
  const f = await fixture(async () => {
    assert.fail("must not execute");
  });
  try {
    const service = f.makeService();
    await assert.rejects(service.setConcurrency({ ...workspace, concurrency: 0 }));
    const remote = await service.create({
      ...draft,
      workspaceIdentity: "remote-project",
      remoteSessionId: "remote",
    });
    await assert.rejects(
      service.start({
        ...workspace,
        workspaceIdentity: "remote-project",
        remoteSessionId: "remote",
        id: remote.id,
      }),
      /remote-unsupported/,
    );
  } finally {
    await f.cleanup();
  }
});

test("unchanged streaming status confirms ownership without rewriting activity or events", async () => {
  const f = await fixture(async () => {});
  const repo = new WorkTaskRepo(f.dbPath);
  try {
    await repo.ready();
    const task = repo.create(draft);
    repo.enqueue(workspace, task.id);
    const claimed = repo.claimNext("owner", Date.now(), 60_000)!;
    assert.equal(repo.updateRun(claimed, "owner", { status: "running" }), true);
    const current = repo.get(workspace, task.id);
    const events = repo.events(workspace, task.id);
    assert.equal(repo.updateRun(claimed, "owner", { status: "running" }), true);
    assert.equal(repo.get(workspace, task.id).updatedAt, current.updatedAt);
    assert.deepEqual(repo.events(workspace, task.id), events);
    assert.equal(repo.updateRun(claimed, "other-owner", { status: "running" }), false);
  } finally {
    repo.close();
    await f.cleanup();
  }
});

test("a rejected stop remains visible as failure instead of claiming successful cancellation", async () => {
  const f = await fixture(async (_task, context) => {
    await new Promise<void>((_resolve, reject) =>
      context.signal.addEventListener(
        "abort",
        () => reject(new Error("stop rejected by runtime")),
        { once: true },
      ),
    );
  });
  try {
    const service = f.makeService();
    const task = await service.create(draft);
    await service.start({ ...workspace, id: task.id });
    await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "preparing");
    await service.cancel({ ...workspace, id: task.id });
    await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "failed");
    assert.equal(
      (await service.list(workspace)).tasks[0]?.failureReason,
      "stop rejected by runtime",
    );
  } finally {
    await f.cleanup();
  }
});

test("start commands wake immediately even if the previous scheduler tick is still closing", async () => {
  const f = await fixture(async () => {});
  try {
    const service = f.makeService({ pollIntervalMs: 60_000 });
    await service.create(draft);
    await service.create({ ...draft, title: "Second immediate task" });
    await service.startAll(workspace);
    await eventually(async () =>
      (await service.list(workspace)).tasks.every((task) => task.status === "review"),
    );
  } finally {
    await f.cleanup();
  }
});

test("a read-only remote Host never claims queued work from another Host", async () => {
  const f = await fixture(async () => {
    assert.fail("remote Host cannot execute");
  });
  const repo = new WorkTaskRepo(f.dbPath);
  try {
    await repo.ready();
    const task = repo.create(draft);
    repo.enqueue(workspace, task.id);
    const service = f.makeService({ allowExecution: false });
    await service.list(workspace);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((await service.list(workspace)).tasks[0]?.status, "queued");
  } finally {
    repo.close();
    await f.cleanup();
  }
});

test("the public task RPC contract carries drafts, commands and scoped change notifications", async () => {
  let executions = 0;
  const f = await fixture(async () => {
    executions++;
  });
  let disposeListener: (() => void) | undefined;
  try {
    const channel = ProxyChannel.fromService(f.makeService());
    const client = ProxyChannel.toService<IWorkTaskService>({
      call: (name, args) => channel.call(undefined, name, args),
      listen: (name, arg) => channel.listen(undefined, name, arg),
    });
    let changes = 0;
    const listener = client.onDynamicChanged(workspace)(() => {
      changes++;
    });
    disposeListener = () => listener.dispose();
    const task = await client.create(draft);
    assert.equal(task.status, "todo");
    assert.equal(executions, 0);
    assert.ok(changes > 0);
    await client.setConcurrency({ ...workspace, concurrency: 2 });
    assert.equal((await client.list(workspace)).concurrency, 2);
    await assert.rejects(
      client.update({ ...draft, id: task.id, workspaceIdentity: "another-host" }),
      /work-task.not-found/,
    );
    await client.start({ ...workspace, id: task.id });
    await eventually(async () => (await client.list(workspace)).tasks[0]?.status === "review");
    assert.equal(executions, 1);
    const done = await client.complete({ ...workspace, id: task.id });
    assert.equal(done.completion, "accepted_without_merge");
    await client.archive({ ...workspace, id: task.id, archived: true });
    assert.deepEqual((await client.list(workspace)).tasks, []);
    assert.equal(
      (await client.list({ ...workspace, includeArchived: true })).tasks[0]?.id,
      task.id,
    );
    assert.ok(
      (await client.getEvents({ ...workspace, id: task.id })).some((e) => e.type === "accepted"),
    );
  } finally {
    disposeListener?.();
    await f.cleanup();
  }
});
