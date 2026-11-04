import assert from "node:assert/strict";
import test from "node:test";
import { cleanProjectTaskData } from "../src/settings/cleanProjectTaskData.js";
const target = { workspacePath: "/same", workspaceIdentity: "remote:project:a" };
function fixture(status = "idle", skipped = false) {
  const calls: unknown[] = [];
  const task = { taskId: "one" };
  const services = {
    zcodeAgentService: {
      listSessions: async (scope: unknown) => {
        calls.push(["read", scope]);
        return [{ sessionId: "one", status }];
      },
    },
    zcodeTaskService: {
      listTasks: async () => [task],
      listPinnedTasks: async () => [task],
      listArchivedTasks: async () => [],
      archiveTask: async (scope: unknown) => {
        calls.push(["archive", scope]);
      },
      unarchiveTask: async (scope: unknown) => {
        calls.push(["restore", scope]);
      },
      deleteArchivedTasks: async (scope: unknown) => {
        calls.push(["purge", scope]);
        return {
          deletedTaskIds: skipped ? [] : ["one"],
          skippedTaskIds: skipped ? ["one"] : [],
          failedTaskIds: [],
        };
      },
    },
  };
  return { calls, services: services as never };
}
test("running/waiting sessions are rejected before any archive or purge", async () => {
  for (const status of ["running", "waiting"]) {
    const { calls, services } = fixture(status);
    await assert.rejects(cleanProjectTaskData(services, target), /running/);
    assert.equal(calls.length, 1);
  }
});
test("cleanup preserves exact identity, deduplicates tasks and uses final purge guard", async () => {
  const { calls, services } = fixture();
  await cleanProjectTaskData(services, target);
  assert.deepEqual(calls.slice(1), [
    ["archive", { ...target, taskId: "one" }],
    ["purge", { ...target, taskIds: ["one"] }],
  ]);
});
test("a racing busy result restores original membership and reports failure", async () => {
  const { calls, services } = fixture("idle", true);
  await assert.rejects(cleanProjectTaskData(services, target), /could not be cleaned/);
  assert.deepEqual(calls.at(-1), ["restore", { ...target, taskId: "one" }]);
});
test("a restore error never recreates an already purged task", async () => {
  const restored: string[] = [];
  const services = {
    zcodeAgentService: { listSessions: async () => [] },
    zcodeTaskService: {
      listTasks: async () => [{ taskId: "deleted" }, { taskId: "busy" }],
      listPinnedTasks: async () => [],
      listArchivedTasks: async () => [],
      archiveTask: async () => {},
      deleteArchivedTasks: async () => ({
        deletedTaskIds: ["deleted"],
        skippedTaskIds: ["busy"],
        failedTaskIds: [],
      }),
      unarchiveTask: async ({ taskId }: { taskId: string }) => {
        restored.push(taskId);
        throw Error("restore unavailable");
      },
    },
  };
  await assert.rejects(cleanProjectTaskData(services as never, target), /restore unavailable/);
  assert.ok(restored.length > 0);
  assert.ok(restored.every((id) => id === "busy"));
});
