import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

test("unread is filtered before count/limit, includes pinned, and keeps same-path identities separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unread-index-"));
  const repo = new TaskIndexRepo(join(directory, "tasks.sqlite"));
  const scope = { workspacePath: "/same", workspaceIdentity: "remote:ssh:a" };
  const meta = {
    ...scope,
    taskId: "old-unread",
    traceId: "test",
    title: "Unread",
    mode: "guarded" as const,
    status: "completed" as const,
    createdAt: 1,
    updatedAt: 1,
    unreadAt: 1,
  };
  try {
    for (let i = 0; i < 30; i++)
      await repo.syncTaskMeta({
        meta: { ...meta, taskId: `read-${i}`, updatedAt: i + 100, unreadAt: undefined },
      });
    await repo.syncTaskMeta({ meta });
    await repo.updateTaskState({ ...scope, taskId: meta.taskId, patch: { pinned: true } });
    await repo.syncTaskMeta({ meta: { ...meta, taskId: "second", updatedAt: 2 } });
    await repo.syncTaskMeta({
      meta: { ...meta, workspaceIdentity: "remote:ssh:b", updatedAt: 999 },
    });
    const query = {
      workspaceScopes: [scope],
      kind: "unread" as const,
      sortBy: "updated" as const,
      limit: 1,
    };
    const first = await repo.queryTaskList(query);
    assert.equal(first.total, 2);
    assert.equal(first.hasMore, true);
    assert.equal(first.items[0]?.taskId, "second");
    await repo.clearTaskUnreadIfMatches({ ...scope, taskId: "second", expectedUnreadAt: 1 });
    const next = await repo.queryTaskList(query);
    assert.equal(next.total, 1);
    assert.equal(next.hasMore, false);
    assert.equal(next.items[0]?.taskId, "old-unread");
    assert.equal(next.items[0]?.workspaceIdentity, scope.workspaceIdentity);
    await repo.updateTaskState({ ...scope, taskId: "old-unread", patch: { archived: true } });
    assert.equal((await repo.queryTaskList(query)).total, 0);
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
