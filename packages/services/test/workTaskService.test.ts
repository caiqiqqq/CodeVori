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

for (const kind of ["api", "acp"] as const) {
  test(`${kind} rename only changes the durable title while execution retains its lease`, async () => {
    let context: WorkTaskExecutionContext | undefined;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const f = await fixture(async (_task, run) => {
      context = run;
      await run.update({ session: { kind, id: `${kind}-session` } });
      await gate;
    });
    try {
      const service = f.makeService();
      const task = await service.create({
        ...draft,
        execution: kind === "api" ? draft.execution : { kind, agent: "codex", config: [] },
      });
      const target = { ...workspace, id: task.id };
      await service.rename({ ...target, title: " Draft title " });
      await service.start(target);
      await eventually(
        async () => !!context && !!(await service.list(workspace)).tasks[0]?.session,
      );
      const before = (await service.list(workspace)).tasks[0]!;
      const renamed = await service.rename({ ...target, title: " Running title " });
      const { title: _old, updatedAt: _time, ...prior } = before;
      const { title, updatedAt: _newTime, ...after } = renamed;
      assert.equal(title, "Running title");
      assert.deepEqual(after, prior);
      const events = await service.getEvents(target);
      await service.rename({ ...target, title });
      assert.deepEqual(await service.getEvents(target), events, "same title is a no-op");
      for (const invalid of [" ", "a".repeat(201)])
        await assert.rejects(service.rename({ ...target, title: invalid }));
      await assert.rejects(
        service.rename({ ...target, workspacePath: "/other", title: "wrong" }),
        /work-task.not-found/,
      );
      await assert.rejects(
        service.rename({ ...target, workspaceIdentity: "other-host", title: "wrong" }),
        /work-task.not-found/,
      );
      await assert.rejects(service.rename({ ...target, title, prompt: "changed" } as never));
      assert.equal(
        await context!.update({ status: "awaiting_input" }),
        true,
        "rename preserves active lease",
      );
      finish();
      await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "review");
      assert.equal(
        (await service.list(workspace)).tasks[0]?.title,
        title,
        "late run cannot overwrite rename",
      );
      await service.complete(target);
      await service.archive({ ...target, archived: true });
      await service.rename({ ...target, title: "Completed title" });
      const repo = new WorkTaskRepo(f.dbPath);
      await repo.ready();
      const canceled = repo.create(draft);
      const canceledTarget = { ...workspace, id: canceled.id };
      repo.enqueue(workspace, canceled.id);
      repo.cancel(workspace, canceled.id);
      repo.close();
      assert.equal(
        (await service.rename({ ...canceledTarget, title: "Canceled title" })).status,
        "canceled",
      );
      await service.disposeAllAndWait();
      assert.equal(
        (await f.makeService().list({ ...workspace, includeArchived: true })).tasks.find(
          (t) => t.id === task.id,
        )?.title,
        "Completed title",
      );
    } finally {
      finish();
      await f.cleanup();
    }
  });
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

for (const kind of ["api", "acp"] as const) {
  test(`${kind} failed task can restart with a fresh session and retain its workspace`, async () => {
    const runs: WorkTask[] = [];
    const binding = { kind, id: "damaged-session" };
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
        throw new Error("damaged context");
      }
      await context.update({ session: { kind, id: "replacement-session" } });
    });
    try {
      const a = f.makeService();
      const b = f.makeService();
      const task = await a.create({
        ...draft,
        execution: kind === "api" ? draft.execution : { kind, agent: "codex" as const, config: [] },
      });
      await a.start({ ...workspace, id: task.id });
      await eventually(async () => (await a.list(workspace)).tasks[0]?.status === "failed");
      const failed = (await b.list(workspace)).tasks[0]!;
      const queued = await b.start({ ...workspace, id: task.id, newSession: true });
      assert.equal(queued.status, "queued");
      assert.equal(queued.session, undefined);
      assert.deepEqual(queued.worktree, worktree);
      assert.notEqual(queued.sessionRequestId, failed.sessionRequestId);
      await assert.rejects(
        a.start({ ...workspace, id: task.id, newSession: true }),
        /work-task.new-session-unavailable/,
      );
      await eventually(async () => (await b.list(workspace)).tasks[0]?.status === "review");
      assert.equal(runs.length, 2);
      assert.equal(runs[1]?.id, task.id);
      assert.equal(runs[1]?.runSeq, 2);
      assert.equal(runs[1]?.session, undefined);
      assert.deepEqual(runs[1]?.worktree, worktree);
      assert.equal(runs[1]?.sessionRequestId, queued.sessionRequestId);
      assert.equal((await a.list(workspace)).tasks[0]?.session?.id, "replacement-session");
      const staleObserver = new WorkTaskRepo(f.dbPath);
      await staleObserver.ready();
      try {
        assert.equal(
          staleObserver.claimConversation(
            failed,
            "stale-host",
            {
              commandId: "old-session-late-command",
              startedAt: Date.now() + 1000,
              status: "running",
            },
            30_000,
          ),
          null,
        );
      } finally {
        staleObserver.close();
      }
      await assert.rejects(
        a.start({ ...workspace, id: task.id, newSession: true }),
        /work-task.new-session-unavailable/,
      );
    } finally {
      await f.cleanup();
    }
  });
}

test("new-session restart rejects unbound and remote tasks without enqueuing", async () => {
  let executions = 0;
  const f = await fixture(async () => {
    executions++;
    throw new Error("failure without binding");
  });
  try {
    const service = f.makeService();
    const task = await service.create(draft);
    await assert.rejects(
      service.start({ ...workspace, id: task.id, newSession: true }),
      /work-task.new-session-unavailable/,
    );
    await service.start({ ...workspace, id: task.id });
    await eventually(async () => (await service.list(workspace)).tasks[0]?.status === "failed");
    await assert.rejects(
      service.start({ ...workspace, id: task.id, newSession: true }),
      /work-task.new-session-unavailable/,
    );
    await assert.rejects(
      service.start({ ...workspace, workspaceIdentity: "remote", id: task.id, newSession: true }),
      /work-task.remote-unsupported/,
    );
    assert.equal(executions, 1);
    assert.equal((await service.list(workspace)).tasks[0]?.status, "failed");
  } finally {
    await f.cleanup();
  }
});

test("two Hosts claim each task once without waiting for another project task", async () => {
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const f = await fixture(async (task, context) => {
    await context.update({ status: "running" });
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
      a.start({ ...workspace, id: two.id }),
      b.start({ ...workspace, id: two.id }),
    ]);
    await eventually(async () => started.length === 2);
    assert.equal(new Set(started).size, 2);
    assert.ok((await a.list(workspace)).tasks.every((task) => task.status === "running"));
    releases.splice(0).forEach((release) => release());
    await eventually(async () =>
      (await a.list(workspace)).tasks.every((t) => t.status === "review"),
    );
    assert.equal(new Set(started).size, 2);
  } finally {
    releases.forEach((release) => release());
    await f.cleanup();
  }
});

for (const concurrency of [undefined, 1, 8]) {
  test(`batch admits four API/ACP tasks regardless of legacy concurrency ${concurrency ?? "unset"}`, async () => {
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const f = await fixture(async (task, context) => {
      await context.update({ status: "running" });
      started.push(task.id);
      await new Promise<void>((resolve) => releases.push(resolve));
    });
    try {
      const service = f.makeService();
      if (concurrency !== undefined) await service.setConcurrency({ ...workspace, concurrency });
      for (let index = 0; index < 10; index++) {
        await service.create({
          ...draft,
          title: `Concurrent task ${index}`,
          execution:
            index % 2 === 0 ? draft.execution : { kind: "acp", agent: "codex", config: [] },
        });
      }
      await service.startAll(workspace);
      await eventually(async () => started.length === 4);
      const board = await service.list(workspace);
      assert.equal(new Set(started).size, 4);
      assert.equal(board.tasks.filter((task) => task.status === "running").length, 4);
      assert.equal(board.tasks.filter((task) => task.status === "queued").length, 6);
      assert.equal(board.concurrency, concurrency ?? 1, "legacy settings retain their read value");
      releases.splice(0).forEach((release) => release());
      await eventually(async () => started.length === 8);
      releases.splice(0).forEach((release) => release());
      await eventually(async () => started.length === 10);
      releases.splice(0).forEach((release) => release());
      await eventually(async () =>
        (await service.list(workspace)).tasks.every((task) => task.status === "review"),
      );
    } finally {
      releases.forEach((release) => release());
      await f.cleanup();
    }
  });
}

test("a task awaiting permission does not block another task in the project", async () => {
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const f = await fixture(async (task, context) => {
    await context.update({ status: task.title === draft.title ? "awaiting_input" : "running" });
    started.push(task.id);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  try {
    const service = f.makeService();
    const one = await service.create(draft);
    const two = await service.create({ ...draft, title: "Independent task" });
    await service.start({ ...workspace, id: one.id });
    await eventually(async () => started.length === 1);
    await service.start({ ...workspace, id: two.id });
    await eventually(async () => started.length === 2);
    const board = await service.list(workspace);
    assert.equal(board.tasks.find((task) => task.id === one.id)?.status, "awaiting_input");
    assert.equal(board.tasks.find((task) => task.id === two.id)?.status, "running");
    releases.splice(0).forEach((release) => release());
    await eventually(async () =>
      (await service.list(workspace)).tasks.every((task) => task.status === "review"),
    );
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
    const renamed = await client.rename({ ...workspace, id: task.id, title: "RPC title" });
    assert.equal(renamed.title, "RPC title");
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

test("direct tasks persist mode, serialize across owners and lock mode/source after binding", async () => {
  const f = await fixture(async () => {});
  try {
    const a = f.makeService({ allowExecution: false });
    await assert.rejects(a.create({ ...draft, useWorktree: false }), /source-branch-required/);
    const first = await a.create({ ...draft, useWorktree: false, sourceBranch: "main" });
    const second = await a.create({
      ...draft,
      workspacePath: "/other",
      useWorktree: false,
      sourceBranch: "feature",
    });
    const isolated = await a.create(draft);
    const repo = new WorkTaskRepo(f.dbPath);
    await repo.ready();
    try {
      for (const task of [first, second, isolated]) repo.enqueue(task, task.id);
      const now = Date.now();
      const claimed = repo.claimNext("one", now, 30_000)!;
      assert.equal(claimed.id, first.id);
      assert.equal(repo.claimNext("two", now, 30_000)?.id, isolated.id);
      assert.equal(repo.claimNext("two", now, 30_000), null);
      assert.ok(
        repo.updateRun(claimed, "one", {
          directBranch: "main",
          session: { kind: "api", id: "bound" },
        }),
      );
      repo.finish(claimed, "one", "retry");
      assert.equal(repo.claimNext("two", Date.now(), 30_000)?.id, second.id);
      assert.throws(
        () => repo.update({ ...draft, id: first.id, sourceBranch: "main", useWorktree: true }),
        /execution-workspace-locked/,
      );
      assert.throws(
        () => repo.update({ ...draft, id: first.id, sourceBranch: "other", useWorktree: false }),
        /source-branch-locked/,
      );
      assert.equal(repo.get(first, first.id).useWorktree, false);
      assert.equal(repo.get(isolated, isolated.id).useWorktree, undefined);
      assert.ok(repo.conversationTasks().some((task) => task.id === first.id));
    } finally {
      repo.close();
    }
  } finally {
    await f.cleanup();
  }
});
