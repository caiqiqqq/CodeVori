import assert from "node:assert/strict";
import test from "node:test";
import { workTaskSchema, type WorkTask } from "@zcode/shared";
import {
  sidebarConversationKey,
  workTaskBoundConversationKeys,
} from "../src/lib/sidebarConversationRows.js";
import { isWorkTaskNotificationSession } from "../src/lib/workTaskNotifications.js";
import { canCompleteWorkTask, canMergeWorkTask } from "../src/lib/workTaskBoard.js";

const worktree = {
  rootPath: "/trees",
  path: "/trees/task",
  projectPath: "/project",
  branchName: "task/one",
  baseCommit: "abc",
};
const task = workTaskSchema.parse({
  workspacePath: "/project",
  id: "workflow-task",
  title: "Feature",
  prompt: "Implement",
  execution: {
    kind: "api",
    modelSelection: { providerId: "test", modelId: "model" },
    mode: "build",
  },
  status: "review",
  archived: false,
  stopPending: false,
  runSeq: 3,
  runText: "Verify",
  commandId: "command",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  createdAt: 1,
  updatedAt: 2,
  worktree,
  workflow: {
    definition: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Delivery",
      stages: [
        { id: "build", name: "Build", instructions: "Implement", nextStageId: "verify" },
        { id: "verify", name: "Verify", instructions: "Check", returnStageId: "build" },
      ],
    },
    currentStageId: "verify",
    history: [
      {
        stageId: "build",
        stageName: "Build",
        targetStageId: "verify",
        execution: {
          kind: "api",
          modelSelection: { providerId: "test", modelId: "model" },
          mode: "build",
        },
        session: { kind: "api", id: "api-old" },
        runSeq: 1,
        transitionedAt: 1,
        worktree,
      },
      {
        stageId: "verify",
        stageName: "Verify",
        targetStageId: "build",
        execution: { kind: "acp", agent: "codex", config: [] },
        session: { kind: "acp", id: "acp-old" },
        runSeq: 2,
        transitionedAt: 2,
        worktree,
      },
    ],
  },
});

test("workflow history hides only exact API and ACP bindings in sidebar and Agent Board", () => {
  const keys = workTaskBoundConversationKeys([task]);
  const api = { workspacePath: "/trees/task", id: "api-old", kind: "native" as const };
  const acp = { workspacePath: "/trees/task", id: "acp-old", kind: "acp" as const, agent: "codex" };
  assert.ok(keys.has(sidebarConversationKey(api)));
  assert.ok(keys.has(sidebarConversationKey(acp)));
  for (const address of [
    { ...api, workspacePath: "/other" },
    { ...api, remoteSessionId: "remote" },
    { ...api, workspaceIdentity: "remote:project" },
    { ...acp, agent: "claude" },
    { ...acp, workspacePath: "/project" },
  ])
    assert.equal(keys.has(sidebarConversationKey(address)), false);
  assert.equal(workTaskBoundConversationKeys([{ ...task, workspaceIdentity: "remote" }]).size, 0);
  assert.equal(workTaskBoundConversationKeys([{ ...task, remoteSessionId: "remote" }]).size, 0);
});

test("workflow history suppresses ordinary notifications only at saved execution addresses", () => {
  assert.ok(isWorkTaskNotificationSession([task], "api", "api-old", "/trees/task"));
  assert.ok(isWorkTaskNotificationSession([task], "acp", "acp-old", "/trees/task"));
  assert.equal(isWorkTaskNotificationSession([task], "acp", "acp-old", "/project"), false);
  assert.equal(isWorkTaskNotificationSession([task], "acp", "api-old", "/project"), false);
  assert.equal(isWorkTaskNotificationSession([task], "api", "ordinary", "/project"), false);
});

test("direct-branch stage history retains the project execution address", () => {
  const direct: WorkTask = {
    ...task,
    worktree: undefined,
    useWorktree: false,
    directBranch: "main",
    workflow: {
      ...task.workflow!,
      history: task.workflow!.history.map((entry) => ({
        ...entry,
        worktree: undefined,
        directBranch: "main",
      })),
    },
  };
  const keys = workTaskBoundConversationKeys([direct]);
  assert.ok(
    keys.has(sidebarConversationKey({ workspacePath: "/project", id: "api-old", kind: "native" })),
  );
  assert.ok(
    keys.has(
      sidebarConversationKey({
        workspacePath: "/project",
        id: "acp-old",
        kind: "acp",
        agent: "codex",
      }),
    ),
  );
  assert.ok(isWorkTaskNotificationSession([direct], "api", "api-old", "/project"));
  assert.equal(isWorkTaskNotificationSession([direct], "api", "api-old", "/trees/task"), false);
});

test("only final workflow stages expose completion and merge acceptance", () => {
  const bound = { ...task, worktree: task.workflow!.history[1]!.worktree };
  assert.equal(canCompleteWorkTask(bound), true);
  assert.equal(canMergeWorkTask(bound, true), true);
  for (const currentStageId of ["build", "unknown"]) {
    const middle: WorkTask = { ...bound, workflow: { ...bound.workflow!, currentStageId } };
    assert.equal(canCompleteWorkTask(middle), false);
    assert.equal(canMergeWorkTask(middle, true), false);
  }
});
