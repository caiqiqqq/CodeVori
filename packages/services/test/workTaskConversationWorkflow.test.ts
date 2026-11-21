import assert from "node:assert/strict";
import test from "node:test";
import { uuidv7, type WorkTaskWorkflow } from "@zcode/shared";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { fixture, scope } from "./workTaskWorkflowFixture.js";

function workflow(): WorkTaskWorkflow {
  return {
    id: uuidv7(),
    name: "Project flow",
    initialStageId: "todo",
    stages: [
      { id: "todo", name: "Todo", status: "todo", instructions: "", handoff: "none" },
      { id: "active", name: "In progress", status: "active", instructions: "", handoff: "none" },
      { id: "done", name: "Done", status: "done", instructions: "", handoff: "none" },
      { id: "canceled", name: "Canceled", status: "canceled", instructions: "", handoff: "none" },
    ],
  };
}

test("ordinary conversations adopt and transition a snapshot without requiring a project owner", async () => {
  const f = await fixture();
  let executionCount = 0;
  const service = new WorkTaskService({
    repo: f.repo,
    execute: async () => {
      executionCount++;
    },
  });
  const restarted = new WorkTaskRepo(f.path);
  try {
    const definition = workflow();
    await service.saveWorkflowDefinition({ workflow: definition, expectedRevision: 0 });
    await service.saveWorkflow({ ...scope, workflowId: definition.id, expectedRevision: 0 });

    const native = await service.attachConversationWorkflow({
      ...scope,
      kind: "api",
      sessionId: "shared-id",
    });
    const acp = await service.attachConversationWorkflow({
      ...scope,
      kind: "acp",
      sessionId: "shared-id",
    });
    assert.equal(native.state.currentStageId, "todo");
    assert.equal(native.state.owner, undefined, "project and stage owners may both be absent");
    assert.equal(acp.state.revision, 1, "API and ACP identities do not collide");

    const moved = await service.transitionConversationWorkflow({
      ...scope,
      kind: "api",
      sessionId: "shared-id",
      expectedRevision: 1,
      expectedStageId: "todo",
      targetStageId: "active",
      handoffNote: "Start after the dependency lands",
    });
    assert.deepEqual(Object.keys(moved).sort(), ["kind", "sessionId", "state", "workspacePath"]);
    assert.equal(moved.state.currentStageId, "active");
    assert.equal(moved.state.revision, 2);
    assert.equal(moved.state.history[0]?.stageName, "Todo");
    assert.equal(moved.state.history[0]?.targetStageId, "active");
    assert.equal(moved.state.history[0]?.handoffNote, "Start after the dependency lands");
    await assert.rejects(
      service.transitionConversationWorkflow({
        ...scope,
        kind: "api",
        sessionId: "shared-id",
        expectedRevision: 1,
        expectedStageId: "todo",
        targetStageId: "done",
      }),
      /conversation-workflow-stale/,
    );

    const board = await service.list(scope);
    assert.equal(board.tasks.length, 0, "ordinary session metadata does not create a WorkTask");
    assert.deepEqual(
      board.conversationWorkflows?.map((record) => [record.kind, record.sessionId]).sort(),
      [
        ["acp", "shared-id"],
        ["api", "shared-id"],
      ],
    );
    assert.equal(
      board.conversationWorkflows?.find((record) => record.kind === "api")?.state.revision,
      2,
    );
    assert.equal(executionCount, 0, "business stage changes do not schedule execution");

    await restarted.ready();
    assert.equal(
      restarted.conversationWorkflows(scope).find((record) => record.kind === "api")?.state
        .currentStageId,
      "active",
      "Host restart restores the accepted stage snapshot",
    );
  } finally {
    restarted.close();
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});

test("conversation workflow adoption is idempotent and requires a selected status workflow", async () => {
  const f = await fixture();
  const service = new WorkTaskService({ repo: f.repo, execute: async () => {} });
  try {
    await assert.rejects(
      service.attachConversationWorkflow({ ...scope, kind: "api", sessionId: "missing" }),
      /conversation-workflow-not-configured/,
    );
    const definition = workflow();
    await service.saveWorkflowDefinition({ workflow: definition, expectedRevision: 0 });
    await service.saveWorkflow({ ...scope, workflowId: definition.id, expectedRevision: 0 });
    const first = await service.attachConversationWorkflow({
      ...scope,
      kind: "api",
      sessionId: "same-session",
    });
    const second = await service.attachConversationWorkflow({
      ...scope,
      kind: "api",
      sessionId: "same-session",
    });
    assert.equal(second.state.currentStageId, first.state.currentStageId);
    assert.equal(second.state.revision, first.state.revision);
    assert.deepEqual(second.state.definition, first.state.definition);
    assert.deepEqual(second.state.history, first.state.history);
    assert.equal((await service.list(scope)).conversationWorkflows?.length, 1);
  } finally {
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});

test("WorkTask-bound conversations cannot acquire an independent workflow", async () => {
  const f = await fixture();
  const service = new WorkTaskService({ repo: f.repo, execute: async () => {} });
  const bindTaskSession = (sessionId: string) => {
    const task = f.repo.create({
      ...scope,
      title: `Bound ${sessionId}`,
      prompt: "Bind existing conversation",
      execution: {
        kind: "api",
        modelSelection: { providerId: "test", modelId: "model" },
        mode: "build",
      },
    });
    f.repo.enqueue(scope, task.id);
    const run = f.repo.claimNext("host", Date.now(), 30_000);
    assert.ok(run);
    assert.ok(
      f.repo.updateRun(run, "host", {
        session: { kind: "api", id: sessionId },
        worktree: {
          rootPath: "/trees",
          path: `/trees/${sessionId}`,
          projectPath: scope.workspacePath,
          branchName: `task/${sessionId}`,
          baseCommit: "base",
        },
      }),
    );
    f.repo.finish(run, "host");
  };
  const sessionScope = (sessionId: string) => ({ workspacePath: `/trees/${sessionId}` });
  try {
    const definition = workflow();
    await service.saveWorkflowDefinition({ workflow: definition, expectedRevision: 0 });
    await service.saveWorkflow({ ...scope, workflowId: definition.id, expectedRevision: 0 });

    bindTaskSession("already-bound");
    await assert.rejects(
      service.attachConversationWorkflow({
        ...sessionScope("already-bound"),
        kind: "api",
        sessionId: "already-bound",
      }),
      /conversation-workflow-already-bound/,
    );

    const laterScope = sessionScope("later-bound");
    await service.saveWorkflow({ ...laterScope, workflowId: definition.id, expectedRevision: 0 });
    await service.attachConversationWorkflow({
      ...laterScope,
      kind: "api",
      sessionId: "later-bound",
    });
    bindTaskSession("later-bound");
    await assert.rejects(
      service.transitionConversationWorkflow({
        ...laterScope,
        kind: "api",
        sessionId: "later-bound",
        expectedRevision: 1,
        expectedStageId: "todo",
        targetStageId: "active",
      }),
      /conversation-workflow-already-bound/,
    );
  } finally {
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});
