import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkTask, WorkTaskStatus } from "@zcode/shared";
import { countWorkTasks, workTaskSidebarScopes } from "../src/lib/workTaskSidebarCounts.js";

const task = (status: WorkTaskStatus, archived = false): WorkTask => ({
  workspacePath: "/project",
  id: status,
  title: "Task",
  prompt: "Implement a task",
  execution: { kind: "acp", agent: "codex", config: [] },
  status,
  archived,
  runSeq: 1,
  runText: "Implement a task",
  commandId: "command",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  stopPending: false,
  createdAt: 1,
  updatedAt: 1,
});

test("sidebar counts preparing/running and accepted done, not other states or archives", () => {
  const states: WorkTaskStatus[] = [
    "todo",
    "queued",
    "preparing",
    "running",
    "awaiting_input",
    "review",
    "failed",
    "done",
    "canceled",
  ];
  assert.deepEqual(countWorkTasks(states.map((status) => task(status))), { running: 2, done: 1 });
  assert.deepEqual(countWorkTasks(states.map((status) => task(status, true))), {
    running: 0,
    done: 0,
  });
  assert.deepEqual(countWorkTasks([]), { running: 0, done: 0 });
});

test("API and every ACP use the same count rules without inspecting conversation status", () => {
  const api: WorkTask = {
    ...task("running"),
    execution: {
      kind: "api",
      modelSelection: { providerId: "api", modelId: "model" },
      mode: "build",
    },
  };
  const acp = ["codex", "claude", "gemini"] as const;
  assert.deepEqual(
    countWorkTasks([
      api,
      ...acp.map((agent) => ({
        ...task("done"),
        execution: { kind: "acp" as const, agent, config: [] },
      })),
    ]),
    { running: 1, done: 3 },
  );
});

test("sidebar scopes deduplicate projects and exclude the non-project conversation directory", () => {
  const scopes = workTaskSidebarScopes([
    { workspacePath: "/project", workspacePurpose: "project" },
    { workspacePath: "/project", workspacePurpose: "project" },
    { workspacePath: "/legacy-project" },
    { workspacePath: "/default", workspacePurpose: "conversation" },
  ]);
  assert.deepEqual(
    scopes.map(({ scope }) => scope.workspacePath),
    ["/project", "/legacy-project"],
  );
});

test("sidebar identity keys are trimmed, preserve actual paths and isolate remote Hosts", () => {
  const scopes = workTaskSidebarScopes([
    { workspacePath: "/same" },
    { workspacePath: "/same", workspaceIdentity: " remote-a ", remoteSessionId: " host-a " },
    { workspacePath: "/other-path", workspaceIdentity: "remote-a", remoteSessionId: "host-a" },
    { workspacePath: "/same", workspaceIdentity: "remote-a", remoteSessionId: "host-b" },
    { workspacePath: "/same", workspaceIdentity: "remote-b", remoteSessionId: "host-a" },
  ]);
  assert.equal(scopes.length, 4);
  assert.equal(new Set(scopes.map(({ key }) => key)).size, 4);
  assert.deepEqual(scopes[1]?.scope, {
    workspacePath: "/same",
    workspaceIdentity: "remote-a",
    remoteSessionId: "host-a",
  });
});
