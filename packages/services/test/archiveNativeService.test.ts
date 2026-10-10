import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  setDataBaseDir,
  getLegacyTaskSessionSnapshotPath,
  getLegacyDeletedTaskSessionSnapshotPath,
} from "../src/paths.js";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";

test("native archive service invokes permanent owner cleanup and preserves failed/busy batch items", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-archive-service-"));
  setDataBaseDir(directory);
  const repo = new TaskIndexRepo(join(directory, "tasks.sqlite"));
  const scope = { workspacePath: "/fixture/project", workspaceIdentity: "remote:fixture" };
  const calls: string[] = [];
  const events: string[] = [];
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const noop = () => ({ dispose() {} });
  const service = createZCodeTaskServiceAdapter({
    taskIndexRepo: repo,
    zcodeAgentService: {
      disposeAll() {},
      purgeSession: async (target: { sessionId: string; workspaceIdentity?: string }) => {
        assert.equal(target.workspaceIdentity, scope.workspaceIdentity);
        calls.push(target.sessionId);
        assert.equal(
          (await repo.getTaskMeta({ ...scope, taskId: target.sessionId }))?.deletionState,
          "pending",
        );
        if (target.sessionId === "failed") throw new Error("fixture connection lost");
        return target.sessionId === "busy" ? "busy" : "deleted";
      },
    } as unknown as Options["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: noop,
      onSessionReadyEvent: noop,
      emitWorkspaceTaskListChanged: (_target: unknown, _meta: unknown, reason: string) =>
        events.push(reason),
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
  });
  try {
    const snapshotPath = getLegacyTaskSessionSnapshotPath(
      scope.workspacePath,
      "deleted",
      scope.workspaceIdentity,
    );
    const backupPath = getLegacyDeletedTaskSessionSnapshotPath(
      scope.workspacePath,
      "deleted",
      scope.workspaceIdentity,
    );
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, "private legacy snapshot");
    await writeFile(backupPath, "private legacy backup");
    for (const taskId of ["deleted", "busy", "failed", "restored"])
      await repo.syncTaskMeta({
        meta: {
          ...scope,
          taskId,
          traceId: taskId,
          title: "private title",
          mode: "build",
          createdAt: 1,
          updatedAt: 2,
        },
        archived: taskId !== "restored",
      });
    assert.equal(await service.deleteArchivedTask({ ...scope, taskId: "restored" }), false);
    assert.deepEqual(
      await service.deleteArchivedTasks({ ...scope, taskIds: ["deleted", "busy", "failed"] }),
      { deletedTaskIds: ["deleted"], skippedTaskIds: ["busy"], failedTaskIds: ["failed"] },
    );
    assert.deepEqual(calls, ["deleted", "busy", "failed"]);
    await assert.rejects(readFile(snapshotPath), { code: "ENOENT" });
    await assert.rejects(readFile(backupPath), { code: "ENOENT" });
    assert.deepEqual(await repo.listDeletedTaskIds(scope), ["deleted"]);
    assert.equal(
      (await repo.getTaskMeta({ ...scope, taskId: "failed" }))?.deletionState,
      "pending",
    );
    assert.equal((await repo.getTaskMeta({ ...scope, taskId: "busy" }))?.deletionState, undefined);
    assert.ok(events.includes("task_deleted"));
  } finally {
    service.disposeAll();
    repo.close();
    setDataBaseDir(null);
    await rm(directory, { recursive: true, force: true });
  }
});
