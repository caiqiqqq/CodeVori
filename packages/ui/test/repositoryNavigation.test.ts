import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTaskNavigationHistory,
  pushNavEntry,
  pushRepositoryNavEntry,
  goBack,
  goForward,
  removeTaskFromHistory,
} from "../src/lib/taskNavigationHistory.js";

test("repository navigation participates in history without clearing tasks or duplicating entries", () => {
  let history = pushNavEntry(createTaskNavigationHistory(), "/project", "task-1");
  history = pushRepositoryNavEntry(history, "/project");
  assert.equal(pushRepositoryNavEntry(history, "/project"), history);
  assert.equal(goBack(history)?.entry.kind, "task");
  assert.equal(goForward(goBack(history)!.history)?.entry.kind, "repository");
  assert.deepEqual(removeTaskFromHistory(history, "task-1").entries, [
    { kind: "repository", workspacePath: "/project" },
  ]);
});

test("identical remote paths retain separate repository navigation identities", () => {
  let history = pushRepositoryNavEntry(createTaskNavigationHistory(), "/project", "remote-a");
  history = pushRepositoryNavEntry(history, "/project", "remote-b");
  assert.equal(history.entries.length, 2);
  assert.equal(goBack(history)?.entry.workspaceIdentity, "remote-a");
  assert.equal(pushRepositoryNavEntry(history, "/project", " remote-b "), history);
});
