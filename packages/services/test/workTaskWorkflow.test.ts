import assert from "node:assert/strict";
import test from "node:test";
import {
  workTaskWorkflowSchema,
  workTaskWorkflowStateSchema,
  type WorkTask,
  type WorkTaskWorkflow,
} from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";

import {
  scope,
  draft,
  definition,
  worktree,
  fixture,
  bindWorkflow,
  finishStage,
} from "./workTaskWorkflowFixture.js";

test("workflow opt-in snapshots only new tasks, persists revisions, and isolates identities", async () => {
  const f = await fixture();
  try {
    const legacy = f.repo.create(draft);
    assert.equal(legacy.workflow, undefined);
    const workflow = definition();
    bindWorkflow(f.repo, workflow);
    assert.equal(f.repo.get(scope, legacy.id).workflow, undefined);
    assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null, "saving never queues work");
    const task = f.repo.create(draft);
    assert.equal(task.workflow?.currentStageId, "build");
    assert.match(task.runText, /Implement feature/);
    assert.match(task.runText, /Implement only/);
    assert.equal(f.repo.workflow({ ...scope, workspaceIdentity: "remote-other" }).workflow, null);
    assert.throws(
      () => f.repo.saveWorkflow({ ...scope, expectedRevision: 0, workflowId: null }),
      /workflow-stale/,
    );
    f.repo.saveWorkflow({ ...scope, expectedRevision: 1, workflowId: null });
    assert.equal(f.repo.create(draft).workflow, undefined);
    assert.deepEqual(f.repo.get(scope, task.id).workflow?.definition, workflow);
    const restarted = new WorkTaskRepo(f.path);
    await restarted.ready();
    try {
      assert.deepEqual(restarted.workflow(scope), { workflow: null, revision: 2 });
      assert.deepEqual(restarted.get(scope, task.id).workflow, task.workflow);
    } finally {
      restarted.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("stage transition atomically queues one fresh session on the same worktree and rejects stale hosts", async () => {
  const f = await fixture();
  const other = new WorkTaskRepo(f.path);
  await other.ready();
  try {
    bindWorkflow(f.repo);
    const task = f.repo.create(draft);
    f.repo.enqueue(scope, task.id);
    const completed = finishStage(f.repo, task);
    const request = {
      ...scope,
      id: task.id,
      expectedRunSeq: completed.runSeq,
      expectedStageId: "build",
      targetStageId: "review",
      handoffNote: "Focus on edge cases",
    };
    assert.throws(() => f.repo.complete(scope, task.id), /workflow-final-stage-required/);
    assert.throws(
      () =>
        f.repo.enqueueMerge({ ...scope, id: task.id, targetBranch: "main" }, scope.workspacePath),
      /workflow-final-stage-required/,
    );
    const next = f.repo.transitionWorkflow(request);
    assert.equal(next.status, "queued");
    assert.equal(next.session, undefined);
    assert.notEqual(next.sessionRequestId, completed.sessionRequestId);
    assert.deepEqual(next.execution, { kind: "acp", agent: "codex", config: [] });
    assert.deepEqual(next.worktree, completed.worktree);
    assert.equal(next.workflow?.history[0]?.session?.id, "session-1");
    assert.equal(next.workflow?.history[0]?.owner, "Developer");
    assert.equal(next.workflow?.history[0]?.handoffNote, "Focus on edge cases");
    assert.match(next.runText, /Verify tests/);
    assert.match(next.runText, /Focus on edge cases/);
    assert.ok(!next.runText.includes("Implement only"), "does not replay prior stage instructions");
    assert.throws(() => other.transitionWorkflow(request), /workflow-transition-stale/);
    assert.deepEqual(f.repo.conversationSessionIds({ workspacePath: worktree.path }, "api"), [
      "session-1",
    ]);
    const final = finishStage(f.repo, next);
    f.repo.finish(completed, "host-a", "late failure");
    assert.deepEqual(f.repo.get(scope, task.id), final, "prior run cannot overwrite next stage");
    assert.equal(final.workflow?.currentStageId, "review", "success never auto advances");
    const returned = f.repo.transitionWorkflow({
      ...request,
      expectedRunSeq: final.runSeq,
      expectedStageId: "review",
      targetStageId: "build",
    });
    assert.equal(returned.workflow?.history.length, 2);
    assert.equal(returned.workflow?.currentStageId, "build");
    const rebuilt = finishStage(f.repo, returned);
    const reviewed = f.repo.transitionWorkflow({ ...request, expectedRunSeq: rebuilt.runSeq });
    finishStage(f.repo, reviewed);
    assert.equal(f.repo.complete(scope, task.id).completion, "accepted_without_merge");
  } finally {
    other.close();
    await f.cleanup();
  }
});

test("active owner, canceled execution, stale sequence, archived tasks and invalid edges cannot transition", async () => {
  const f = await fixture();
  try {
    bindWorkflow(f.repo);
    const task = f.repo.create(draft);
    const request = {
      ...scope,
      id: task.id,
      expectedRunSeq: 0,
      expectedStageId: "build",
      targetStageId: "review",
    };
    assert.throws(() => f.repo.transitionWorkflow(request), /workflow-transition-stale/);
    f.repo.enqueue(scope, task.id);
    assert.throws(() => f.repo.transitionWorkflow(request), /workflow-transition-stale/);
    const run = f.repo.claimNext("owner", Date.now(), 30_000)!;
    assert.throws(
      () => f.repo.transitionWorkflow({ ...request, expectedRunSeq: run.runSeq }),
      /workflow-transition-stale/,
    );
    f.repo.cancel(scope, task.id);
    assert.throws(
      () => f.repo.transitionWorkflow({ ...request, expectedRunSeq: run.runSeq }),
      /workflow-transition-stale/,
    );
    f.repo.finish(run, "owner");
    f.repo.enqueue(scope, task.id);
    const completed = finishStage(f.repo, task);
    assert.throws(() => f.repo.transitionWorkflow(request), /workflow-transition-stale/);
    assert.throws(
      () =>
        f.repo.transitionWorkflow({
          ...request,
          expectedRunSeq: completed.runSeq,
          targetStageId: "build",
        }),
      /workflow-transition-invalid/,
    );
    f.repo.archive(scope, task.id, true);
    assert.throws(
      () => f.repo.transitionWorkflow({ ...request, expectedRunSeq: completed.runSeq }),
      /workflow-transition-stale/,
    );
    assert.equal(f.repo.get(scope, task.id).workflow?.history.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("workflow schema rejects duplicate IDs, missing next edges, unknown and forward return targets", () => {
  for (const mutate of [
    (w: WorkTaskWorkflow) => {
      w.stages[1]!.id = "build";
    },
    (w: WorkTaskWorkflow) => {
      delete w.stages[0]!.nextStageId;
    },
    (w: WorkTaskWorkflow) => {
      w.stages[1]!.nextStageId = "build";
    },
    (w: WorkTaskWorkflow) => {
      w.stages[1]!.returnStageId = "missing";
    },
    (w: WorkTaskWorkflow) => {
      w.stages[0]!.returnStageId = "review";
    },
  ]) {
    const workflow = definition();
    mutate(workflow);
    assert.equal(workTaskWorkflowSchema.safeParse(workflow).success, false);
  }
});

test("editing a failed handed-off stage preserves its stage requirements and handoff note", async () => {
  const f = await fixture();
  try {
    bindWorkflow(f.repo);
    const task = f.repo.create(draft);
    f.repo.enqueue(scope, task.id);
    const first = finishStage(f.repo, task);
    f.repo.transitionWorkflow({
      ...scope,
      id: task.id,
      expectedRunSeq: first.runSeq,
      expectedStageId: "build",
      targetStageId: "review",
      handoffNote: "Check cancellation",
    });
    const claimed = f.repo.claimNext("owner", Date.now(), 30_000)!;
    f.repo.finish(claimed, "owner", "Stage failed");
    const edited = f.repo.update({
      ...draft,
      id: task.id,
      execution: claimed.execution,
      prompt: "Updated feature",
    });
    assert.match(edited.runText, /Updated feature/);
    assert.match(edited.runText, /Verify tests/);
    assert.match(edited.runText, /Check cancellation/);
    f.repo.enqueue(scope, task.id);
    const final = finishStage(f.repo, edited);
    const request = {
      ...scope,
      id: task.id,
      expectedRunSeq: final.runSeq,
      expectedStageId: "review",
      targetStageId: "build",
    };
    f.repo.enqueueMerge({ ...scope, id: task.id, targetBranch: "main" }, scope.workspacePath);
    assert.throws(() => f.repo.transitionWorkflow(request), /workflow-transition-stale/);
    assert.equal(f.repo.get(scope, task.id).workflow?.history.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("workflow state rejects unknown stages and mismatched historical session kinds", () => {
  const state = { definition: definition(), currentStageId: "build", history: [] };
  assert.equal(workTaskWorkflowStateSchema.safeParse(state).success, true);
  assert.equal(
    workTaskWorkflowStateSchema.safeParse({ ...state, currentStageId: "unknown" }).success,
    false,
  );
  const entry = {
    stageId: "build",
    stageName: "Build",
    targetStageId: "review",
    session: { kind: "api", id: "session" },
    execution: draft.execution,
    runSeq: 1,
    transitionedAt: 1,
  };
  assert.equal(workTaskWorkflowStateSchema.safeParse({ ...state, history: [entry] }).success, true);
  for (const patch of [{ targetStageId: "unknown" }, { session: { kind: "acp", id: "session" } }])
    assert.equal(
      workTaskWorkflowStateSchema.safeParse({ ...state, history: [{ ...entry, ...patch }] })
        .success,
      false,
    );
});

test("Host publishes workflow edits, schedules transitions and rejects remote workflow commands", async () => {
  const f = await fixture();
  const runs: WorkTask[] = [];
  const service = new WorkTaskService({
    repo: f.repo,
    pollIntervalMs: 10,
    execute: async (task, context) => {
      runs.push(task);
      await context.update({
        session: { kind: task.execution.kind, id: `host-session-${task.runSeq}` },
        worktree,
      });
    },
  });
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const task = (await service.list(scope)).tasks.find((row) => row.id === id)!;
      if (task.status === "review") return task;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("stage did not settle");
  };
  let changes = 0;
  const listener = service.onDynamicChanged(scope)(() => {
    changes++;
  });
  try {
    const workflow = definition();
    await service.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
    await service.saveWorkflow({ ...scope, expectedRevision: 0, workflowId: workflow.id });
    assert.ok(changes > 0);
    assert.equal((await service.list(scope)).workflowRevision, 1);
    const task = await service.create(draft);
    await service.start({ ...scope, id: task.id });
    const first = await settled(task.id);
    assert.equal(runs.length, 1);
    await assert.rejects(
      service.complete({ ...scope, id: task.id }),
      /workflow-final-stage-required/,
    );
    await service.transitionWorkflow({
      ...scope,
      id: task.id,
      expectedRunSeq: first.runSeq,
      expectedStageId: "build",
      targetStageId: "review",
    });
    await settled(task.id);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]!.session, undefined);
    await assert.rejects(
      service.saveWorkflow({
        ...scope,
        workspaceIdentity: "remote-id",
        expectedRevision: 0,
        workflowId: workflow.id,
      }),
      /remote-unsupported/,
    );
    await service.complete({ ...scope, id: task.id });
  } finally {
    listener.dispose();
    await service.disposeAllAndWait();
    await f.cleanup();
  }
});
