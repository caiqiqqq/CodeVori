import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WorkTask } from "@zcode/shared";
import type { WorkTaskExecutionContext } from "../src/session/contract.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";

const scope = { workspacePath: "/project" };
const draft = {
  ...scope,
  title: "Feature",
  prompt: "Build",
  sourceBranch: "main",
  execution: { kind: "acp" as const, agent: "codex" as const, config: [] },
};
const tree = {
  rootPath: "/trees",
  projectPath: "/project",
  path: "/trees/task/project",
  branchName: "worktree/task",
  baseCommit: "base",
};

async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("task did not settle");
}

async function fixture(
  executeMerge: (task: WorkTask, context: WorkTaskExecutionContext) => Promise<void>,
  failExecution = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-merge-owner-"));
  const services: WorkTaskService[] = [];
  const makeService = () => {
    const service = new WorkTaskService({
      repo: new WorkTaskRepo(join(directory, "tasks.sqlite")),
      pollIntervalMs: 10,
      execute: async (_task, context) => {
        await context.update({ worktree: tree, session: { kind: "acp", id: "original" } });
        if (failExecution) throw new Error("Synthetic failure");
      },
      merge: { validate: async () => ({ projectPath: "/project" }), execute: executeMerge },
    });
    services.push(service);
    return service;
  };
  const first = makeService();
  const task = await first.create(draft);
  await first.start({ ...scope, id: task.id });
  await eventually(
    async () =>
      (await first.list(scope)).tasks[0]?.status === (failExecution ? "failed" : "review"),
  );
  return {
    first,
    task,
    makeService,
    async cleanup() {
      for (const service of services) await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("source branch is persisted and cannot be changed after allocation", async () => {
  const f = await fixture(async () => {}, true);
  try {
    assert.equal((await f.first.list(scope)).tasks[0]?.sourceBranch, "main");
    // Editable failed tasks must still retain their fixed worktree base.
    const other = await f.first.create(draft);
    await assert.rejects(
      f.first.update({ ...draft, id: f.task.id, sourceBranch: "release" }),
      /work-task.source-branch-locked/,
    );
    const updated = await f.first.update({ ...draft, id: other.id, sourceBranch: "release" });
    assert.equal(updated.sourceBranch, "release");
    const cleared = await f.first.update({ ...draft, id: other.id, sourceBranch: undefined });
    assert.equal(cleared.sourceBranch, undefined);
  } finally {
    await f.cleanup();
  }
});

test("two Hosts admit one merge, preserve the original binding and only finish after Git publication", async () => {
  const runs: { task: WorkTask; context: WorkTaskExecutionContext; release(): void }[] = [];
  const f = await fixture(async (task, context) => {
    await new Promise<void>((resolve) => runs.push({ task, context, release: resolve }));
    await context.update({ merge: { ...task.merge!, phase: "merged", resultCommit: "result" } });
  });
  try {
    const second = f.makeService();
    const request = { ...scope, id: f.task.id, targetBranch: "main" };
    await Promise.all([f.first.merge(request), second.merge(request)]);
    await eventually(async () => runs.length === 1);
    assert.equal((await f.first.list(scope)).tasks[0]?.status, "preparing");
    await assert.rejects(
      second.merge({ ...request, targetBranch: "release" }),
      /merge-in-progress/,
    );
    runs[0]!.release();
    await eventually(async () => (await f.first.list(scope)).tasks[0]?.status === "done");
    const complete = (await f.first.list(scope)).tasks[0]!;
    assert.equal(complete.completion, "merged");
    assert.equal(complete.merge?.resultCommit, "result");
    assert.deepEqual(complete.session, { kind: "acp", id: "original" });
    assert.deepEqual(complete.worktree, tree);
  } finally {
    runs.forEach((run) => run.release());
    await f.cleanup();
  }
});

test("different project scopes still serialize merges to the same repository target", async () => {
  const runs: { task: WorkTask; release(): void }[] = [];
  const f = await fixture(async (task) => {
    await new Promise<void>((resolve) => runs.push({ task, release: resolve }));
  });
  try {
    const second = f.makeService();
    const otherScope = { workspacePath: "/project/subdir" };
    const other = await second.create({ ...draft, ...otherScope });
    await second.start({ ...otherScope, id: other.id });
    await eventually(async () => (await second.list(otherScope)).tasks[0]?.status === "review");
    await f.first.merge({ ...scope, id: f.task.id, targetBranch: "main" });
    await second.merge({ ...otherScope, id: other.id, targetBranch: "main" });
    await eventually(async () => runs.length === 1);
    assert.equal((await second.list(otherScope)).tasks[0]?.status, "queued");
    runs[0]!.release();
    await eventually(async () => runs.length === 2);
    runs[1]!.release();
  } finally {
    runs.forEach((run) => run.release());
    await f.cleanup();
  }
});

test("cancel and late merge results return to review; applying cannot be canceled", async () => {
  const runs: { task: WorkTask; context: WorkTaskExecutionContext; release(): void }[] = [];
  const f = await fixture(async (task, context) => {
    await new Promise<void>((resolve) => runs.push({ task, context, release: resolve }));
  });
  try {
    await f.first.merge({ ...scope, id: f.task.id, targetBranch: "main" });
    await eventually(async () => runs.length === 1);
    const first = runs[0]!;
    await f.first.cancel({ ...scope, id: f.task.id });
    assert.equal(first.context.signal.aborted, true);
    assert.equal(
      await first.context.update({ merge: { ...first.task.merge!, phase: "merged" } }),
      false,
    );
    first.release();
    await eventually(async () => !(await f.first.list(scope)).tasks[0]?.stopPending);
    const canceled = (await f.first.list(scope)).tasks[0]!;
    assert.equal(canceled.status, "review");
    assert.equal(canceled.merge?.phase, "canceled");
    await f.first.merge({ ...scope, id: f.task.id, targetBranch: "main" });
    await eventually(async () => runs.length === 2);
    const next = runs[1]!;
    await next.context.update({
      merge: { ...next.task.merge!, phase: "applying", resultCommit: "result" },
    });
    await assert.rejects(f.first.cancel({ ...scope, id: f.task.id }), /merge-applying/);
    assert.equal(
      await first.context.update({ merge: { ...first.task.merge!, phase: "merged" } }),
      false,
    );
    next.release();
    await eventually(async () => (await f.first.list(scope)).tasks[0]?.status === "review");
  } finally {
    runs.forEach((run) => run.release());
    await f.cleanup();
  }
});

test("merge failure preserves journal and returns to review instead of falsely completing", async () => {
  const f = await fixture(async (task, context) => {
    await context.update({
      merge: {
        ...task.merge!,
        phase: "resolving",
        conflicts: ["file.ts"],
        session: { kind: "acp", id: "resolver" },
      },
    });
    throw new Error("work-task.merge-unresolved");
  });
  try {
    await f.first.merge({ ...scope, id: f.task.id, targetBranch: "main" });
    await eventually(async () => (await f.first.list(scope)).tasks[0]?.merge?.phase === "failed");
    const failed = (await f.first.list(scope)).tasks[0]!;
    assert.equal(failed.status, "review");
    assert.equal(failed.failureReason, "work-task.merge-unresolved");
    assert.equal(failed.merge?.session?.id, "resolver");
    assert.equal(failed.session?.id, "original");
    assert.equal(failed.completion, undefined);
  } finally {
    await f.cleanup();
  }
});

for (const phase of ["resolving", "applying", "merged", "canceled"] as const) {
  test(`Host recovery of ${phase} merge retains its journal for explicit review without requeueing`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-merge-recovery-"));
    const file = join(directory, "tasks.sqlite");
    const repo = new WorkTaskRepo(file);
    const reopened = new WorkTaskRepo(file);
    try {
      await repo.ready();
      const task = repo.create(draft);
      const now = Date.now();
      repo.enqueue(scope, task.id);
      const development = repo.claimNext("development", now, 1000)!;
      assert.equal(
        repo.updateRun(development, "development", {
          worktree: tree,
          session: { kind: "acp", id: "original" },
        }),
        true,
      );
      repo.finish(development, "development");
      repo.enqueueMerge({ ...scope, id: task.id, targetBranch: "main" }, "/project");
      const run = repo.claimNext("merge-owner", now, 1000)!;
      const merge = {
        ...run.merge!,
        phase,
        sourceCommit: "source",
        targetCommit: "target",
        resultCommit: "result",
        worktree: { ...tree, path: "/trees/merge/project", branchName: "merge/integration" },
        session: { kind: "acp" as const, id: "resolver" },
      };
      assert.equal(repo.updateRun(run, "merge-owner", { status: "running", merge }), true);
      repo.close();
      await reopened.ready();
      reopened.recoverExpired(now + 1001);
      const recovered = reopened.get(scope, task.id);
      assert.equal(recovered.status, "review");
      assert.equal(recovered.failureReason, "work-task.host-interrupted");
      assert.equal(recovered.merge?.phase, "failed");
      assert.equal(recovered.merge?.resultCommit, "result");
      assert.deepEqual(recovered.merge?.worktree, merge.worktree);
      assert.deepEqual(recovered.merge?.session, merge.session);
      assert.deepEqual(recovered.session, { kind: "acp", id: "original" });
      assert.deepEqual(recovered.worktree, tree);
      assert.equal(recovered.completion, undefined);
      assert.equal(reopened.claimNext("new-owner", now + 1002, 1000), null);
      assert.equal(reopened.updateRun(run, "merge-owner", { status: "running" }), false);
    } finally {
      repo.close();
      reopened.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
