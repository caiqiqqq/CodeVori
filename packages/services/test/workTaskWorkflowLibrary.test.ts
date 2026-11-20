import assert from "node:assert/strict";
import test from "node:test";
import { workTaskWorkflowSchema, type WorkTaskWorkflow } from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { scope, draft, definition, fixture, finishStage } from "./workTaskWorkflowFixture.js";

test("settings library owns reusable definitions; project selection and edits preserve old task snapshots", async () => {
  const f = await fixture();
  try {
    const workflow = definition();
    const first = f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
    assert.equal(first.revision, 1);
    assert.equal(f.repo.workflow(scope).workflow, null, "creating a definition does not assign it");
    f.repo.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
    const otherScope = { workspacePath: "/other-project" };
    f.repo.saveWorkflow({ ...otherScope, workflowId: workflow.id, expectedRevision: 0 });
    const before = f.repo.create(draft);
    f.repo.saveWorkflowDefinition({
      workflow: { ...workflow, name: "Updated" },
      expectedRevision: 1,
    });
    assert.equal(f.repo.workflow(otherScope).workflow?.name, "Updated");
    assert.equal(f.repo.create(draft).workflow?.definition.name, "Updated");
    assert.equal(f.repo.get(scope, before.id).workflow?.definition.name, "Delivery");
    assert.throws(
      () => f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 1 }),
      /workflow-stale/,
    );
    assert.throws(
      () => f.repo.deleteWorkflowDefinition({ id: workflow.id, expectedRevision: 2 }),
      /workflow-in-use/,
    );
    assert.deepEqual(
      new Set(f.repo.listWorkflows()[0]!.projectKeys),
      new Set([scope.workspacePath, otherScope.workspacePath]),
    );
    for (const target of [scope, otherScope])
      f.repo.saveWorkflow({
        ...target,
        workflowId: null,
        expectedRevision: f.repo.workflow(target).revision,
      });
    f.repo.deleteWorkflowDefinition({ id: workflow.id, expectedRevision: 2 });
    assert.equal(f.repo.listWorkflows().length, 0);
    assert.equal(f.repo.get(scope, before.id).workflow?.definition.id, workflow.id);
    assert.equal(
      f.repo.claimNext("owner", Date.now(), 30_000),
      null,
      "catalog operations never run agents",
    );
  } finally {
    await f.cleanup();
  }
});

test("none and member handoffs do not run agents or allocate a new session", async () => {
  const f = await fixture();
  try {
    const workflow = definition();
    workflow.stages[1]!.handoff = "member";
    workflow.stages[1]!.owner = "Alice";
    delete workflow.stages[1]!.execution;
    f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
    f.repo.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
    const task = f.repo.create(draft);
    f.repo.enqueue(scope, task.id);
    const completed = finishStage(f.repo, task);
    const next = f.repo.transitionWorkflow({
      ...scope,
      id: task.id,
      expectedRunSeq: completed.runSeq,
      expectedStageId: "build",
      targetStageId: "review",
    });
    assert.equal(next.status, "review");
    assert.equal(next.workflow?.owner, "Alice");
    assert.deepEqual(next.session, completed.session);
    assert.equal(next.sessionRequestId, completed.sessionRequestId);
    assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null);
  } finally {
    await f.cleanup();
  }
});

function statusWorkflow(): WorkTaskWorkflow {
  const stages = ["backlog", "todo", "active", "review", "blocked", "done", "canceled"] as const;
  return {
    id: definition().id,
    name: "研发流程",
    initialStageId: "todo",
    stages: stages.map((status) => ({
      id: status,
      status,
      name: status,
      instructions: "",
      enabled: true,
      handoff: "none",
    })),
  };
}

test("status workflows start at Todo; only an explicit Agent entry queues one run", async () => {
  const f = await fixture();
  const other = new WorkTaskRepo(f.path);
  await other.ready();
  try {
    const workflow = statusWorkflow();
    Object.assign(workflow.stages.find((s) => s.id === "active")!, {
      handoff: "agent",
      execution: draft.execution,
      instructions: "Implement only",
    });
    workflow.stages.find((s) => s.id === "backlog")!.enabled = false;
    f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
    f.repo.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
    const task = f.repo.create(draft);
    assert.equal(task.workflow?.currentStageId, "todo");
    assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null);
    const request = {
      ...scope,
      id: task.id,
      expectedRunSeq: 0,
      expectedStageId: "todo",
      targetStageId: "active",
    };
    assert.throws(
      () => f.repo.transitionWorkflow({ ...request, targetStageId: "backlog" }),
      /workflow-transition-stale/,
    );
    const queued = f.repo.transitionWorkflow(request);
    assert.equal(queued.status, "queued");
    assert.throws(() => other.transitionWorkflow(request), /workflow-transition-stale/);
    const finished = finishStage(f.repo, queued);
    assert.equal(
      finished.workflow?.currentStageId,
      "active",
      "successful execution never advances business status",
    );
    assert.throws(() => f.repo.complete(scope, task.id), /workflow-final-stage-required/);
    const member = workflow.stages.find((s) => s.id === "review")!;
    member.handoff = "member";
    member.owner = "Alice";
    // 已有任务仍使用创建时的快照；目录后续编辑不能改变其交接行为。
    f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 1 });
    const passive = f.repo.transitionWorkflow({
      ...request,
      expectedRunSeq: finished.runSeq,
      expectedStageId: "active",
      targetStageId: "review",
    });
    assert.equal(passive.workflow?.owner, undefined);
    assert.deepEqual(passive.session, finished.session);
    assert.equal(passive.sessionRequestId, finished.sessionRequestId);
    assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null);
    const done = f.repo.transitionWorkflow({
      ...request,
      expectedRunSeq: finished.runSeq,
      expectedStageId: "review",
      targetStageId: "done",
    });
    assert.equal(done.status, "review", "Done still requires explicit acceptance");
    assert.equal(f.repo.complete(scope, task.id).completion, "accepted_without_merge");
    assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null);
  } finally {
    other.close();
    await f.cleanup();
  }
});

for (const handoff of ["none", "member"] as const)
  test(`${handoff} status entry retains executor/session; canceled is not acceptance`, async () => {
    const f = await fixture();
    try {
      const workflow = statusWorkflow();
      Object.assign(workflow.stages.find((s) => s.id === "review")!, {
        handoff,
        owner: handoff === "member" ? "Alice" : undefined,
      });
      f.repo.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
      f.repo.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
      const task = f.repo.create(draft);
      f.repo.enqueue(scope, task.id);
      const finished = finishStage(f.repo, task);
      const next = f.repo.transitionWorkflow({
        ...scope,
        id: task.id,
        expectedRunSeq: finished.runSeq,
        expectedStageId: "todo",
        targetStageId: "review",
      });
      assert.equal(next.workflow?.owner, handoff === "member" ? "Alice" : undefined);
      assert.deepEqual(next.execution, finished.execution);
      assert.deepEqual(next.session, finished.session);
      assert.equal(next.sessionRequestId, finished.sessionRequestId);
      const canceled = f.repo.transitionWorkflow({
        ...scope,
        id: task.id,
        expectedRunSeq: finished.runSeq,
        expectedStageId: "review",
        targetStageId: "canceled",
      });
      assert.equal(canceled.status, "canceled");
      assert.throws(() => f.repo.complete(scope, task.id), /workflow-final-stage-required/);
      assert.equal(f.repo.claimNext("owner", Date.now(), 30_000), null);
    } finally {
      await f.cleanup();
    }
  });

test("modern definitions validate fixed statuses, order, optional steps, and handoff requirements", () => {
  assert.equal(workTaskWorkflowSchema.safeParse(statusWorkflow()).success, true);
  const mutations: ((workflow: WorkTaskWorkflow) => void)[] = [
    (w) => {
      w.stages[2]!.execution = draft.execution;
    },
    (w) => {
      w.initialStageId = "backlog";
    },
    (w) => {
      w.stages.find((s) => s.id === "todo")!.enabled = false;
    },
    (w) => {
      w.stages = w.stages.filter((s) => s.id !== "done");
    },
    (w) => {
      w.stages.push({ ...w.stages.at(-1)!, id: "duplicate-canceled" });
    },
    (w) => {
      w.stages[2]!.handoff = "agent";
    },
    (w) => {
      w.stages[2]!.handoff = "member";
    },
    (w) => {
      w.stages[2]!.enabled = false;
    },
    (w) => {
      w.stages[2]!.status = undefined;
    },
    (w) => {
      Object.assign(w.stages.find((s) => s.id === "done")!, {
        handoff: "agent",
        execution: draft.execution,
      });
    },
    (w) => {
      w.stages.find((s) => s.id === "canceled")!.returnStageId = "todo";
    },
    (w) => {
      [w.stages[1], w.stages[2]] = [w.stages[2]!, w.stages[1]!];
    },
    (w) => {
      w.stages.find((s) => s.id === "todo")!.nextStageId = "missing";
    },
  ];
  for (const mutate of mutations) {
    const workflow = statusWorkflow();
    mutate(workflow);
    assert.equal(workTaskWorkflowSchema.safeParse(workflow).success, false);
  }
});

test("library survives restart and publishes edits across Hosts with CAS protection", async () => {
  const f = await fixture();
  const otherRepo = new WorkTaskRepo(f.path);
  const a = new WorkTaskService({
    repo: f.repo,
    pollIntervalMs: 10,
    execute: async () => {
      assert.fail("configuration must not execute");
    },
  });
  const b = new WorkTaskService({
    repo: otherRepo,
    pollIntervalMs: 10,
    execute: async () => {
      assert.fail("configuration must not execute");
    },
  });
  let catalogChanges = 0,
    projectChanges = 0;
  const catalog = b.onDynamicWorkflowsChanged()(() => catalogChanges++);
  const project = b.onDynamicChanged(scope)(() => projectChanges++);
  try {
    const workflow = statusWorkflow();
    await a.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
    await a.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
    await b.list(scope);
    const count = catalogChanges;
    await a.saveWorkflowDefinition({
      workflow: { ...workflow, name: "Updated" },
      expectedRevision: 1,
    });
    for (let i = 0; i < 50 && catalogChanges === count; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(catalogChanges > count);
    assert.ok(projectChanges > 0);
    assert.equal((await b.list(scope)).workflow?.name, "Updated");
    await assert.rejects(
      b.saveWorkflowDefinition({ workflow, expectedRevision: 1 }),
      /workflow-stale/,
    );
    await assert.rejects(
      b.saveWorkflow({ ...scope, workflowId: null, expectedRevision: 1 }),
      /workflow-stale/,
    );
    await assert.rejects(
      b.saveWorkflow({
        ...scope,
        workspacePath: "/other",
        workflowId: definition().id,
        expectedRevision: 0,
      }),
      /workflow-not-found/,
    );
    const restarted = new WorkTaskRepo(f.path);
    await restarted.ready();
    try {
      assert.equal(restarted.listWorkflows()[0]?.workflow.name, "Updated");
      assert.equal(restarted.workflow(scope).workflow?.id, workflow.id);
    } finally {
      restarted.close();
    }
  } finally {
    catalog.dispose();
    project.dispose();
    await a.disposeAllAndWait();
    await b.disposeAllAndWait();
    await f.cleanup();
  }
});
