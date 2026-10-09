import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkTaskNavigationStore,
  workTaskNavigationKey,
  WORK_TASK_ALL_PROJECTS,
} from "../src/store/workTaskNavigationStore.js";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
const project = { workspacePath: "/project" };
const other = { workspacePath: "/other" };

test("all-project navigation persists without replacing individual task selections", () => {
  const storage = memoryStorage();
  const store = createWorkTaskNavigationStore(storage);
  store.getState().selectTask(project, "task");
  store.getState().selectAllProjects();
  const restored = createWorkTaskNavigationStore(storage).getState();
  assert.equal(restored.project, WORK_TASK_ALL_PROJECTS);
  assert.equal(restored.tasks[workTaskNavigationKey(project)], "task");
});

test("restores last project and independent task selections after recreation", () => {
  const storage = memoryStorage();
  const store = createWorkTaskNavigationStore(storage).getState();
  store.selectProject(project);
  store.selectTask(project, "api-task");
  store.selectProject(other);
  store.selectTask(other, "acp-task");
  const restored = createWorkTaskNavigationStore(storage).getState();
  assert.equal(restored.project, workTaskNavigationKey(other));
  assert.equal(restored.tasks[workTaskNavigationKey(project)], "api-task");
  assert.equal(restored.tasks[workTaskNavigationKey(other)], "acp-task");
});

test("scope isolation uses trimmed identity, path fallback and remote session", () => {
  const owner = createWorkTaskNavigationStore(null);
  const store = owner.getState();
  const remote = { ...project, workspaceIdentity: " remote-id ", remoteSessionId: " host-a " };
  store.selectTask(project, "local");
  store.selectTask(remote, "remote-a");
  store.selectTask({ ...remote, remoteSessionId: "host-b" }, "remote-b");
  const tasks = owner.getState().tasks;
  assert.equal(tasks[workTaskNavigationKey(project)], "local");
  assert.equal(tasks[workTaskNavigationKey(remote)], "remote-a");
  assert.equal(tasks[workTaskNavigationKey({ ...remote, remoteSessionId: "host-b" })], "remote-b");
  assert.equal(
    workTaskNavigationKey({ ...project, workspaceIdentity: " " }),
    workTaskNavigationKey(project),
  );
  assert.equal(
    workTaskNavigationKey(remote),
    workTaskNavigationKey({
      workspacePath: "/changed",
      workspaceIdentity: "remote-id",
      remoteSessionId: "host-a",
    }),
  );
  assert.notEqual(workTaskNavigationKey(remote), workTaskNavigationKey(project));
  assert.notEqual(
    workTaskNavigationKey(remote),
    workTaskNavigationKey({ ...remote, remoteSessionId: "host-b" }),
  );
});

test("late close cannot clear a newer selection and clearing survives recreation", () => {
  const storage = memoryStorage();
  const store = createWorkTaskNavigationStore(storage);
  store.getState().selectTask(project, "old");
  store.getState().selectTask(project, "new");
  store.getState().clearTask(project, "old");
  assert.equal(store.getState().tasks[workTaskNavigationKey(project)], "new");
  store.getState().clearTask(project, "new");
  assert.equal(
    createWorkTaskNavigationStore(storage).getState().tasks[workTaskNavigationKey(project)],
    undefined,
  );
});

test("corrupt or unavailable storage falls back without losing in-memory choice", () => {
  for (const raw of [
    "{",
    "null",
    '{"project":42,"tasks":{"key":false}}',
    '{"project":null,"tasks":[]}',
  ]) {
    const store = createWorkTaskNavigationStore({ getItem: () => raw, setItem() {} });
    assert.equal(store.getState().project, null);
    assert.deepEqual(store.getState().tasks, {});
  }
  const store = createWorkTaskNavigationStore({
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  });
  store.getState().selectProject(project);
  store.getState().selectTask(project, "task");
  assert.equal(store.getState().project, workTaskNavigationKey(project));
  assert.equal(store.getState().tasks[workTaskNavigationKey(project)], "task");
});
