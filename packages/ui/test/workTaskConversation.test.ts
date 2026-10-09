import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkTask } from "@zcode/shared";
import { workTaskConversationBinding } from "../src/lib/workTaskConversation.js";
import { workTaskWorkspaceToolTarget } from "../src/lib/workTaskWorkspaceTools.js";

const task: WorkTask = {
  workspacePath: "/project",
  id: "task-1",
  title: "Task",
  prompt: "Implement a task",
  execution: {
    kind: "api",
    modelSelection: { providerId: "api", modelId: "model" },
    mode: "build",
  },
  status: "todo",
  archived: false,
  runSeq: 0,
  runText: "Implement a task",
  commandId: "command-1",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  stopPending: false,
  createdAt: 1,
  updatedAt: 1,
};
const worktree = {
  rootPath: "/trees",
  path: "/trees/abcd/project",
  projectPath: "/project",
  branchName: "worktree/abcd",
  baseCommit: "abcdef",
};

test("unstarted or partly bound work tasks cannot create a conversation target", () => {
  assert.equal(workTaskConversationBinding(task), null);
  assert.equal(workTaskConversationBinding({ ...task, worktree }), null);
  assert.equal(
    workTaskConversationBinding({ ...task, session: { kind: "api", id: "native" } }),
    null,
  );
});

test("API work task opens only its saved native session in the worktree", () => {
  assert.deepEqual(
    workTaskConversationBinding({ ...task, worktree, session: { kind: "api", id: "native" } }),
    { kind: "api", workspacePath: worktree.path, sessionId: "native" },
  );
});

test("ACP Host session carries its exact agent and never becomes a native binding", () => {
  for (const agent of ["codex", "claude", "gemini"] as const) {
    assert.deepEqual(
      workTaskConversationBinding({
        ...task,
        worktree,
        session: { kind: "acp", id: `host-${agent}` },
        execution: { kind: "acp", agent, config: [] },
      }),
      { kind: "acp", workspacePath: worktree.path, sessionId: `host-${agent}`, agent },
    );
  }
});

test("mismatched executor or unsupported remote scope cannot route to local history", () => {
  const bound: WorkTask = { ...task, worktree, session: { kind: "api", id: "native" } };
  assert.equal(
    workTaskConversationBinding({ ...bound, session: { kind: "acp", id: "host" } }),
    null,
  );
  assert.equal(
    workTaskConversationBinding({ ...bound, workspaceIdentity: "remote:project" }),
    null,
  );
  assert.equal(workTaskConversationBinding({ ...bound, remoteSessionId: "attachment" }), null);
});

test("task tools use the project before allocation and the worktree before session binding", () => {
  assert.deepEqual(workTaskWorkspaceToolTarget(task), {
    taskId: task.id,
    workspacePath: task.workspacePath,
    workspaceIdentity: undefined,
    remoteSessionId: undefined,
    nativeSessionId: null,
    sidePaneOwnerId: "work-task:task-1",
  });
  assert.equal(workTaskWorkspaceToolTarget({ ...task, worktree }).workspacePath, worktree.path);
});

test("API and ACP tools share the exact bound worktree without routing ACP as native", () => {
  const api = workTaskWorkspaceToolTarget({
    ...task,
    worktree,
    session: { kind: "api", id: "native" },
  });
  assert.equal(api.workspacePath, worktree.path);
  assert.equal(api.nativeSessionId, "native");
  assert.equal(api.sidePaneOwnerId, "native");
  const acp = workTaskWorkspaceToolTarget({
    ...task,
    worktree,
    execution: { kind: "acp", agent: "codex", config: [] },
    session: { kind: "acp", id: "host-codex" },
  });
  assert.equal(acp.workspacePath, worktree.path);
  assert.equal(acp.nativeSessionId, null);
  assert.equal(acp.sidePaneOwnerId, "host-codex");
});

test("remote task tools retain identity and attachment, ignoring local-looking worktree paths", () => {
  const target = workTaskWorkspaceToolTarget({
    ...task,
    worktree,
    workspaceIdentity: "remote-project",
    remoteSessionId: "attachment",
    session: { kind: "api", id: "native" },
  });
  assert.equal(target.workspacePath, task.workspacePath);
  assert.equal(target.workspaceIdentity, "remote-project");
  assert.equal(target.remoteSessionId, "attachment");
  assert.equal(target.nativeSessionId, null);
  assert.equal(target.sidePaneOwnerId, "work-task:task-1");
});

test("merge conversations and tools use the saved integration binding without replacing the original", () => {
  const bound: WorkTask = {
    ...task,
    worktree,
    session: { kind: "api", id: "native" },
    merge: {
      id: "00000000-0000-4000-8000-000000000002",
      projectPath: "/project",
      targetBranch: "release",
      phase: "resolving",
      worktree: { ...worktree, path: "/trees/merge/project", branchName: "merge/test" },
      session: { kind: "api", id: "resolver" },
    },
  };
  assert.deepEqual(workTaskConversationBinding(bound, true), {
    kind: "api",
    workspacePath: "/trees/merge/project",
    sessionId: "resolver",
  });
  assert.equal(workTaskWorkspaceToolTarget(bound, true).workspacePath, "/trees/merge/project");
  assert.equal(workTaskWorkspaceToolTarget(bound, true).nativeSessionId, "resolver");
  assert.equal(workTaskConversationBinding(bound, false)?.sessionId, "native");
  assert.equal(workTaskConversationBinding({ ...bound, remoteSessionId: "remote" }, true), null);
  assert.equal(
    workTaskConversationBinding({ ...bound, merge: { ...bound.merge!, session: undefined } }, true),
    null,
  );
  assert.equal(bound.session?.id, "native");
});

test("direct API/ACP bindings and tools use the persisted project directory", () => {
  for (const kind of ["api", "acp"] as const) {
    const direct: WorkTask = {
      ...task,
      useWorktree: false,
      sourceBranch: "feature",
      directBranch: "feature",
      session: { kind, id: "direct-session" },
      execution: kind === "api" ? task.execution : { kind, agent: "codex", config: [] },
    };
    assert.equal(workTaskConversationBinding(direct)?.workspacePath, task.workspacePath);
    assert.equal(workTaskWorkspaceToolTarget(direct).workspacePath, task.workspacePath);
    assert.equal(workTaskConversationBinding({ ...direct, directBranch: undefined }), null);
    assert.equal(workTaskConversationBinding({ ...direct, remoteSessionId: "remote" }), null);
  }
});
