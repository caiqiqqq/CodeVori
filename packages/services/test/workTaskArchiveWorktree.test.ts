import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { workTaskArchiveSchema, type WorkTask } from "@zcode/shared";
import { ProxyChannel } from "@zcode/rpc";
import type { IWorkTaskService } from "../src/session/contract.js";

const scope = { workspacePath: "/project" };
const allocation = {
  rootPath: "/trees",
  path: "/trees/abcd/project",
  projectPath: "/project",
  branchName: "worktree/abcd",
  baseCommit: "abcdef",
};

for (const kind of ["api", "acp"] as const) {
  test(`${kind} archive cleanup is scoped, exclusive and archives only after removal`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-task-cleanup-"));
    let calls = 0;
    let fail = true;
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const repo = new WorkTaskRepo(join(dir, "tasks.sqlite"));
    const service = new WorkTaskService({
      repo,
      execute: async (_task, context) => {
        await context.update({ worktree: allocation });
      },
      removeWorktree: async (task: WorkTask) => {
        calls++;
        assert.deepEqual(task.worktree, allocation);
        assert.equal(repo.get(scope, task.id).archived, false);
        entered?.();
        if (release)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (fail) throw new Error("work-task.worktree-remove-dirty-worktree");
      },
      pollIntervalMs: 10,
    });
    const channel = ProxyChannel.fromService(service);
    const client = ProxyChannel.toService<IWorkTaskService>({
      call: (name, args) => channel.call(undefined, name, args),
      listen: (name, args) => channel.listen(undefined, name, args),
    });
    try {
      const task = await service.create({
        ...scope,
        title: "Cleanup",
        prompt: "Implement",
        execution:
          kind === "api"
            ? { kind, modelSelection: { providerId: "test", modelId: "model" }, mode: "build" }
            : { kind, agent: "codex", config: [] },
      });
      const input = { ...scope, id: task.id, archived: true, removeWorktree: true };
      await assert.rejects(service.archive(input), /not-cleanable/);
      await assert.rejects(
        service.archive({ ...input, workspaceIdentity: "remote" }),
        /remote-unsupported/,
      );
      await assert.rejects(
        service.archive({ ...input, remoteSessionId: "remote" }),
        /remote-unsupported/,
      );
      await assert.rejects(service.archive({ ...input, workspacePath: "/other" }), /not-found/);
      assert.equal(calls, 0);
      await service.start({ ...scope, id: task.id });
      for (let i = 0; i < 100 && repo.get(scope, task.id).status !== "review"; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      await service.complete({ ...scope, id: task.id });
      await service.archive({ ...scope, id: task.id, archived: true });
      assert.equal(calls, 0, "ordinary archive must never delete files");
      await service.archive({ ...scope, id: task.id, archived: false });
      const observed: string[] = [];
      const subscription = client.onDynamicChanged(scope)(() => {
        const snapshot = repo.get(scope, task.id);
        observed.push(snapshot.archived ? "archived" : (snapshot.worktreeCleanup?.phase ?? "idle"));
      });
      const acceptedFailure = await client.archive(input);
      assert.equal(acceptedFailure.archived, false);
      assert.equal(acceptedFailure.worktreeCleanup?.phase, "running");
      await waitFor(() => repo.get(scope, task.id).worktreeCleanup?.phase === "failed");
      assert.equal(
        repo.get(scope, task.id).worktreeCleanup?.error,
        "work-task.worktree-remove-dirty-worktree",
      );
      assert.equal(repo.get(scope, task.id).archived, false);
      fail = false;
      release = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const cleaning = await client.archive(input);
      assert.equal(cleaning.archived, false);
      assert.equal(cleaning.worktreeCleanup?.phase, "running");
      await started;
      await assert.rejects(service.archive(input), /cleanup-in-progress/);
      await assert.rejects(
        service.archive({ ...scope, id: task.id, archived: false }),
        /cleanup-in-progress/,
      );
      const other = await service.create({
        ...scope,
        title: "Other task",
        prompt: "Keep working",
        execution: task.execution,
      });
      assert.equal(
        (await service.archive({ ...scope, id: other.id, archived: true })).archived,
        true,
      );
      const persistedRead = new WorkTaskRepo(join(dir, "tasks.sqlite"));
      await persistedRead.ready();
      assert.equal(persistedRead.get(scope, task.id).worktreeCleanup?.phase, "running");
      persistedRead.close();
      const board = await client.list(scope);
      assert.equal(
        board.tasks[0]?.worktreeCleanup?.phase,
        "running",
        "reconnecting client reads Host fact",
      );
      await assert.rejects(client.complete({ ...scope, id: task.id }), /cleanup-in-progress/);
      await assert.rejects(client.cancel({ ...scope, id: task.id }), /cleanup-in-progress/);
      release?.();
      await waitFor(() => repo.get(scope, task.id).archived);
      assert.equal(repo.get(scope, task.id).worktreeCleanup, undefined);
      assert.equal(calls, 2);
      assert.equal(observed[0], "running");
      assert.ok(observed.includes("failed"));
      assert.equal(observed.at(-1), "archived");
      subscription.dispose();
      assert.deepEqual(repo.get(scope, task.id).worktree, allocation, "retain history allocation");
    } finally {
      release?.();
      await service.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("cleanup cannot be combined with unarchive and archive accepts no UI path override", () => {
  const input = { ...scope, id: "task", archived: false, removeWorktree: true };
  assert.equal(workTaskArchiveSchema.safeParse(input).success, false);
  assert.equal(
    workTaskArchiveSchema.safeParse({ ...input, archived: true, path: "/other" }).success,
    false,
  );
});

test("completed direct tasks, missing allocations and unsupported Hosts cannot delete a directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-no-cleanup-"));
  let calls = 0;
  const repo = new WorkTaskRepo(join(dir, "tasks.sqlite"));
  const service = new WorkTaskService({
    repo,
    pollIntervalMs: 10,
    execute: async (task, context) => {
      if (task.useWorktree === false) await context.update({ directBranch: "main" });
    },
    removeWorktree: async () => {
      calls++;
    },
  });
  const unavailable = new WorkTaskService({ repo, execute: async () => {}, allowExecution: false });
  try {
    for (const direct of [false, true]) {
      const task = await service.create({
        ...scope,
        title: "No allocation",
        prompt: "Complete",
        ...(direct ? { useWorktree: false, sourceBranch: "main" } : {}),
        execution: {
          kind: "api",
          modelSelection: { providerId: "test", modelId: "model" },
          mode: "build",
        },
      });
      await service.start({ ...scope, id: task.id });
      for (let i = 0; i < 100 && repo.get(scope, task.id).status !== "review"; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      await service.complete({ ...scope, id: task.id });
      const input = { ...scope, id: task.id, archived: true, removeWorktree: true };
      await assert.rejects(service.archive(input), /not-cleanable/);
      await assert.rejects(unavailable.archive(input), /remote-unsupported/);
      assert.equal(repo.get(scope, task.id).archived, false);
    }
    assert.equal(calls, 0);
  } finally {
    await service.disposeAllAndWait();
    await unavailable.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(predicate(), true);
}

test("expired cleanup lease recovers without automatic deletion and ignores old attempt results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-recovery-"));
  const repo = new WorkTaskRepo(join(dir, "tasks.sqlite"));
  const service = new WorkTaskService({
    repo,
    pollIntervalMs: 10,
    execute: async (_task, context) => {
      await context.update({ worktree: allocation });
    },
  });
  try {
    const task = await service.create({
      ...scope,
      title: "Recovery",
      prompt: "Work",
      execution: {
        kind: "api",
        modelSelection: { providerId: "test", modelId: "model" },
        mode: "build",
      },
    });
    await service.start({ ...scope, id: task.id });
    await waitFor(() => repo.get(scope, task.id).status === "review");
    await service.complete({ ...scope, id: task.id });
    const old = repo.beginWorktreeCleanup(scope, task.id, "old-host", 10);
    repo.recoverExpired(Date.now() + 100);
    assert.equal(repo.get(scope, task.id).worktreeCleanup?.phase, "failed");
    assert.equal(repo.get(scope, task.id).worktreeCleanup?.error, "work-task.host-interrupted");
    const retry = repo.beginWorktreeCleanup(scope, task.id, "old-host", 30_000);
    assert.notEqual(retry.worktreeCleanup?.id, old.worktreeCleanup?.id);
    assert.equal(repo.finishWorktreeCleanup(old, "old-host"), false);
    assert.equal(repo.get(scope, task.id).archived, false);
    assert.equal(repo.finishWorktreeCleanup(retry, "old-host"), true);
    assert.equal(repo.get(scope, task.id).archived, true);
  } finally {
    await service.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Host shutdown drains accepted cleanup and preserves retryable interruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-shutdown-"));
  const repo = new WorkTaskRepo(join(dir, "tasks.sqlite"));
  let release!: () => void;
  const removal = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new WorkTaskService({
    repo,
    pollIntervalMs: 10,
    execute: async (_task, context) => {
      await context.update({ worktree: allocation });
    },
    removeWorktree: () => removal,
  });
  try {
    const task = await service.create({
      ...scope,
      title: "Shutdown",
      prompt: "Work",
      execution: {
        kind: "api",
        modelSelection: { providerId: "test", modelId: "model" },
        mode: "build",
      },
    });
    await service.start({ ...scope, id: task.id });
    await waitFor(() => repo.get(scope, task.id).status === "review");
    await service.complete({ ...scope, id: task.id });
    const accepted = await service.archive({
      ...scope,
      id: task.id,
      archived: true,
      removeWorktree: true,
    });
    assert.equal(accepted.worktreeCleanup?.phase, "running");
    repo.recoverExpired(Date.now() + 31_000);
    await assert.rejects(
      service.archive({ ...scope, id: task.id, archived: true, removeWorktree: true }),
      /cleanup-in-progress/,
      "expired fact cannot replace still-running local IO",
    );
    service.disposeAll();
    assert.equal(repo.get(scope, task.id).archived, false, "storage remains open during cleanup");
    release();
    await service.disposeAllAndWait();
    const reopened = new WorkTaskRepo(join(dir, "tasks.sqlite"));
    await reopened.ready();
    const final = reopened.get(scope, task.id);
    assert.equal(final.archived, false);
    assert.equal(final.status, "done");
    assert.equal(final.worktreeCleanup?.error, "work-task.host-interrupted");
    reopened.close();
  } finally {
    release();
    await service.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});
