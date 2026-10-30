import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";

test("API child membership is excluded before search pagination and scoped to identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-list-"));
  const repo = new TaskIndexRepo(join(directory, "tasks.sqlite"));
  const ordinary = { workspacePath: "/project", workspaceIdentity: "one" };
  const other = { workspacePath: "/project", workspaceIdentity: "two" };
  let membershipUnavailable = false;
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const noop = () => ({ dispose() {} });
  const service = createZCodeTaskServiceAdapter({
    taskIndexRepo: repo,
    zcodeAgentService: { disposeAll() {} } as Options["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: noop,
      onSessionReadyEvent: noop,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    hiddenSessionIds: async (scope) => {
      if (membershipUnavailable) throw new Error("membership unavailable");
      return scope.workspaceIdentity === "one" ? ["child"] : [];
    },
  });
  try {
    for (const [scope, taskId, updatedAt] of [
      [ordinary, "child", 30],
      [ordinary, "visible", 20],
      [other, "child", 10],
    ] as const)
      await repo.syncTaskMeta({
        meta: {
          ...scope,
          taskId,
          traceId: taskId,
          title: "searchable",
          mode: "build",
          provider: "glm",
          createdAt: updatedAt,
          updatedAt,
        },
      });
    const query = {
      kind: "timeline" as const,
      workspaceScopes: [ordinary, other],
      sortBy: "updated" as const,
      search: "searchable",
      limit: 2,
    };
    const result = await service.listTaskList(query);
    assert.deepEqual(
      result.items.map((item) => [item.workspaceIdentity, item.taskId]),
      [
        ["one", "visible"],
        ["two", "child"],
      ],
    );
    assert.equal(result.total, 2);
    assert.equal(result.hasMore, false);
    assert.deepEqual(
      (await service.listTasks(ordinary)).map((item) => item.taskId),
      ["visible"],
    );
    assert.deepEqual(
      (await service.listTasks(other)).map((item) => item.taskId),
      ["child"],
    );
    await repo.syncTaskMeta({
      meta: {
        ...ordinary,
        taskId: "child",
        traceId: "child",
        title: "searchable",
        mode: "build",
        provider: "glm",
        createdAt: 30,
        updatedAt: 30,
      },
      archived: true,
    });
    assert.deepEqual(await service.listArchivedTasks(ordinary), []);
    assert.deepEqual(await service.listArchivedWorkspaces(), []);
    await repo.syncTaskMeta({
      meta: {
        ...ordinary,
        taskId: "child",
        traceId: "child",
        title: "searchable",
        mode: "build",
        provider: "glm",
        createdAt: 30,
        updatedAt: 30,
      },
      archived: false,
      pinned: true,
    });
    assert.deepEqual(await service.listPinnedTasks(ordinary), []);
    assert.deepEqual(await service.listPinnedTaskIds(), []);
    membershipUnavailable = true;
    await assert.rejects(service.listTasks(ordinary), /membership unavailable/);
    await assert.rejects(service.listTaskList(query), /membership unavailable/);
  } finally {
    service.disposeAll();
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
