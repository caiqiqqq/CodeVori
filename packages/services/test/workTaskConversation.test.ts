import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7 } from "@zcode/shared";
import type {
  WorkTaskConversationEvent,
  WorkTaskConversationPort,
} from "../src/session/contract.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("conversation task state did not settle");
}

async function fixture(kind: "api" | "acp", failInitial = true) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-conversation-"));
  const services: WorkTaskService[] = [];
  const changes = new Emitter<WorkTaskConversationEvent>();
  const stops: WorkTaskConversationEvent[] = [];
  let executions = 0;
  let watchers = 0;
  let failStop = false;
  const conversation: WorkTaskConversationPort = {
    watch(_task, listener) {
      watchers++;
      const subscription = changes.event(listener);
      return {
        dispose() {
          watchers--;
          subscription.dispose();
        },
      };
    },
    async stop(_task, event) {
      stops.push(event);
      if (failStop) throw new Error("Synthetic stop failed");
    },
  };
  const makeService = (allowExecution = true) => {
    const service = new WorkTaskService({
      repo: new WorkTaskRepo(join(directory, "tasks.sqlite")),
      conversation,
      allowExecution,
      pollIntervalMs: 20,
      execute: async (task, context) => {
        executions++;
        await context.update({
          session: { kind, id: "bound-session" },
          worktree: {
            rootPath: "/trees",
            path: "/trees/abcd/project",
            projectPath: "/project",
            branchName: "worktree/abcd",
            baseCommit: "abcdef",
          },
        });
        if (failInitial) throw new Error("Synthetic first failure");
      },
      merge: {
        validate: async () => ({ projectPath: "/project" }),
        execute: async (task, context) => {
          await context.update({
            merge: { ...task.merge!, phase: "merged", resultCommit: "result" },
          });
        },
      },
    });
    services.push(service);
    return service;
  };
  const service = makeService();
  const scope = { workspacePath: "/project" };
  const task = await service.create({
    ...scope,
    title: "Task",
    prompt: "Original instructions",
    execution:
      kind === "api"
        ? { kind, modelSelection: { providerId: "test", modelId: "model" }, mode: "build" }
        : { kind, agent: "codex", config: [] },
  });
  await service.start({ ...scope, id: task.id });
  const read = async () =>
    (await services.at(-1)!.list(scope)).tasks.find((row) => row.id === task.id)!;
  await until(async () => (await read()).status === (failInitial ? "failed" : "review"));
  const event = (
    commandId = uuidv7(),
    status: WorkTaskConversationEvent["status"] = "running",
  ) => ({
    commandId,
    status,
    startedAt: Date.now() + 1,
    foregroundExecutionId: "foreground",
  });
  return {
    service,
    task,
    scope,
    changes,
    read,
    event,
    makeService,
    stops,
    get executions() {
      return executions;
    },
    get watchers() {
      return watchers;
    },
    failStop() {
      failStop = true;
    },
    async cleanup() {
      for (const owner of services) await owner.disposeAllAndWait();
      changes.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const kind of ["api", "acp"] as const) {
  for (const completion of ["accepted_without_merge", "merged"] as const) {
    test(`${kind} ${completion} task resumes after Host restart and claims once without replay`, async () => {
      const f = await fixture(kind, false);
      try {
        if (completion === "merged") {
          await f.service.merge({ ...f.scope, id: f.task.id, targetBranch: "main" });
          await until(async () => (await f.read()).status === "done");
        } else await f.service.complete({ ...f.scope, id: f.task.id });
        const completed = await f.read();
        assert.equal(completed.completion, completion);
        assert.equal(f.watchers, 1, "completed task must retain its passive observation");
        await f.service.disposeAllAndWait();
        const restarted = f.makeService();
        await restarted.list(f.scope);
        const secondHost = f.makeService();
        await secondHost.list(f.scope);
        assert.equal(f.watchers, 2);
        f.changes.fire(f.event(completed.commandId));
        f.changes.fire({ ...f.event(), startedAt: completed.updatedAt - 1 });
        f.changes.fire(f.event(undefined, "review"));
        assert.equal(
          (await f.read()).status,
          "done",
          "old or terminal-only facts preserve completion",
        );
        await assert.rejects(restarted.start({ ...f.scope, id: f.task.id }), /not-startable/);
        const next = f.event();
        f.changes.fire(next);
        f.changes.fire(next);
        const running = await f.read();
        assert.equal(running.status, "running");
        assert.equal(running.runSeq, completed.runSeq + 1);
        assert.equal(running.commandId, next.commandId);
        assert.equal(running.completion, undefined);
        assert.equal(running.merge, undefined);
        assert.deepEqual(running.session, completed.session);
        assert.deepEqual(running.worktree, completed.worktree);
        assert.equal(f.executions, 1, "observing a new input never executes the task again");
        f.changes.fire({ ...next, commandId: completed.commandId, status: "review" });
        assert.equal(
          (await f.read()).status,
          "running",
          "old completion cannot settle the new run",
        );
        f.changes.fire({ ...next, status: "awaiting_input" });
        assert.equal((await f.read()).status, "awaiting_input");
        f.changes.fire({ ...next, status: "review" });
        assert.equal((await f.read()).status, "review");
        assert.equal((await f.read()).completion, undefined);
        await restarted.complete({ ...f.scope, id: f.task.id });
        await restarted.archive({ ...f.scope, id: f.task.id, archived: true });
        f.changes.fire(f.event());
        const archived = (await secondHost.list({ ...f.scope, includeArchived: true })).tasks[0]!;
        assert.equal(archived.status, "done");
        assert.equal(archived.archived, true);
      } finally {
        await f.cleanup();
      }
    });
  }

  test(`${kind} direct continuation is observed without replaying the message`, async () => {
    const f = await fixture(kind);
    try {
      const original = await f.read();
      assert.equal(f.watchers, 1);
      const next = f.event();
      f.changes.fire(next);
      const running = await f.read();
      assert.equal(running.status, "running");
      assert.equal(running.failureReason, undefined);
      assert.equal(running.runSeq, 2);
      assert.equal(running.commandId, next.commandId);
      assert.deepEqual(running.session, original.session);
      assert.deepEqual(running.worktree, original.worktree);
      assert.deepEqual(running.execution, original.execution);
      assert.equal(f.executions, 1, "observation must not execute/create/prompt again");
      f.changes.fire(next);
      assert.equal((await f.read()).runSeq, 2, "repeated running events must not claim twice");
      f.changes.fire({ ...next, status: "awaiting_input" });
      assert.equal((await f.read()).status, "awaiting_input");
      f.changes.fire({ ...next, status: "running" });
      assert.equal((await f.read()).status, "running");
      f.changes.fire({ ...next, status: "review" });
      await until(async () => (await f.read()).status === "review");
      f.changes.fire(next);
      assert.equal((await f.read()).status, "review", "settled command cannot restart itself");
      const again = f.event();
      f.changes.fire(again);
      assert.equal((await f.read()).status, "running");
      f.changes.fire({ ...next, status: "failed", error: "Old error" });
      assert.equal((await f.read()).status, "running", "late terminal must not settle new run");
      f.changes.fire({ ...again, status: "failed", error: "New model error" });
      await until(async () => (await f.read()).status === "failed");
      assert.equal((await f.read()).failureReason, "New model error");
      assert.equal((await f.read()).runSeq, 3);
    } finally {
      await f.cleanup();
    }
  });

  test(`${kind} shared observation claims once, permits other tasks and cancels only its command`, async () => {
    const f = await fixture(kind);
    try {
      const secondHost = f.makeService();
      await secondHost.list(f.scope);
      assert.equal(f.watchers, 2);
      const run = f.event();
      f.changes.fire(run);
      assert.equal((await f.read()).runSeq, 2);
      const waiting = await f.service.create({
        ...f.scope,
        title: "Waiting",
        prompt: "Not started yet",
        execution: (await f.read()).execution,
      });
      await f.service.start({ ...f.scope, id: waiting.id });
      await until(
        async () =>
          (await f.service.list(f.scope)).tasks.find((row) => row.id === waiting.id)?.status ===
          "failed",
      );
      assert.equal(f.executions, 2, "another task executes before the observed continuation ends");
      assert.equal((await f.read()).status, "running");
      await f.service.cancel({ ...f.scope, id: f.task.id });
      await until(async () => !(await f.read()).stopPending);
      assert.equal((await f.read()).status, "canceled");
      assert.equal(f.stops.length, 1);
      assert.equal(f.stops[0]?.commandId, run.commandId);
      f.changes.fire({ ...run, status: "review" });
      f.changes.fire(f.event());
      assert.equal((await f.read()).status, "canceled");
    } finally {
      await f.cleanup();
    }
  });
}

test("observation ignores old starts, terminal-only events, archived tasks and read-only Hosts", async () => {
  const f = await fixture("api");
  try {
    const failed = await f.read();
    f.changes.fire({ ...f.event(), startedAt: failed.updatedAt - 1 });
    f.changes.fire({ ...f.event(failed.commandId), startedAt: failed.updatedAt + 1 });
    f.changes.fire(f.event(undefined, "review"));
    assert.equal((await f.read()).status, "failed");
    await f.service.archive({ ...f.scope, id: f.task.id, archived: true });
    f.changes.fire(f.event());
    assert.equal(f.watchers, 0);
    await f.service.archive({ ...f.scope, id: f.task.id, archived: false });
    const next = f.event();
    f.changes.fire(next);
    f.changes.fire({ ...next, status: "review" });
    await until(async () => (await f.read()).status === "review");
    await f.service.complete({ ...f.scope, id: f.task.id });
    await f.service.archive({ ...f.scope, id: f.task.id, archived: true });
    f.changes.fire(f.event());
    assert.equal(
      (await f.service.list({ ...f.scope, includeArchived: true })).tasks[0]?.status,
      "done",
    );
    await f.service.disposeAllAndWait();
    const readOnly = f.makeService(false);
    await readOnly.list(f.scope);
    assert.equal(f.watchers, 0);
    assert.equal(f.executions, 1);
  } finally {
    await f.cleanup();
  }
});

test("Host restart restores passive watchers, stop failure is visible and shutdown releases watchers", async () => {
  const f = await fixture("acp");
  try {
    await f.service.disposeAllAndWait();
    assert.equal(f.watchers, 0);
    const restarted = f.makeService();
    await restarted.list(f.scope);
    assert.equal(f.watchers, 1);
    assert.equal(f.executions, 1);
    const run = f.event();
    f.changes.fire(run);
    f.failStop();
    await restarted.cancel({ ...f.scope, id: f.task.id });
    await until(async () => !(await f.read()).stopPending);
    assert.equal((await f.read()).status, "failed");
    assert.equal((await f.read()).failureReason, "Synthetic stop failed");
  } finally {
    await f.cleanup();
  }
});
