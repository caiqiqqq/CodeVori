import assert from "node:assert/strict";
import { test } from "node:test";
import { createRepositoryNavigationStore } from "../src/store/repositoryNavigationStore.js";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
const local = { workspacePath: "/project" };
const remote = { ...local, workspaceIdentity: " remote-one " };

test("restores project and independent remotes after recreation and reconnection", () => {
  const storage = memoryStorage();
  const store = createRepositoryNavigationStore(storage).getState();
  store.selectProject(remote);
  store.selectRemote(local, "private");
  store.selectRemote(remote, "upstream");
  store.selectRemote({ ...remote, workspaceIdentity: "remote-two" }, "origin");
  const restored = createRepositoryNavigationStore(storage).getState();
  assert.deepEqual(restored.project, { ...local, workspaceIdentity: "remote-one" });
  assert.equal(restored.remotes["/project"], "private");
  assert.equal(restored.remotes["remote-one"], "upstream");
  assert.equal(restored.remotes["remote-two"], "origin");
  restored.selectRemote({ workspacePath: "/changed", workspaceIdentity: "remote-one" }, "other");
  assert.equal(createRepositoryNavigationStore(storage).getState().remotes["remote-one"], "other");
  restored.selectProject({ ...local, workspaceIdentity: " " });
  assert.deepEqual(createRepositoryNavigationStore(storage).getState().project, local);
});

test("stale removed-remote replies cannot clear a newer choice or another identity", () => {
  const storage = memoryStorage();
  const store = createRepositoryNavigationStore(storage);
  store.getState().selectRemote(local, "private");
  store.getState().selectRemote(remote, "private");
  store.getState().selectRemote(local, "new");
  store.getState().clearRemote(local, "private");
  assert.equal(store.getState().remotes["/project"], "new");
  store.getState().clearRemote(local, "new");
  const restored = createRepositoryNavigationStore(storage).getState();
  assert.equal(restored.remotes["/project"], undefined);
  assert.equal(restored.remotes["remote-one"], "private");
});

test("corrupt and blocked storage do not block in-memory navigation", () => {
  for (const raw of [
    "{",
    "null",
    '{"project":42,"remotes":{}}',
    '{"project":null,"remotes":[]}',
    '{"project":null,"remotes":{"a":false}}',
  ]) {
    const store = createRepositoryNavigationStore({ getItem: () => raw, setItem() {} });
    assert.equal(store.getState().project, null);
    assert.deepEqual(store.getState().remotes, {});
  }
  const store = createRepositoryNavigationStore({
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  });
  store.getState().selectProject(local);
  store.getState().selectRemote(local, "private");
  assert.deepEqual(store.getState().project, local);
  assert.equal(store.getState().remotes["/project"], "private");
});
