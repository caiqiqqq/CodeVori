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
      await assert.rejects(client.archive(input), /dirty-worktree/);
      assert.equal(repo.get(scope, task.id).archived, false);
      fail = false;
      release = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const cleaning = client.archive(input);
      await started;
      await assert.rejects(service.archive(input), /cleanup-in-progress/);
      await assert.rejects(
        service.archive({ ...scope, id: task.id, archived: false }),
        /cleanup-in-progress/,
      );
      release?.();
      assert.equal((await cleaning).archived, true);
      assert.equal(calls, 2);
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
