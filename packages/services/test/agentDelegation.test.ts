import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, type DelegationCreate, type DelegationTask } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { DelegationRepository } from "../src/delegation/delegationRepository.js";

const parent = { workspacePath: "/project", kind: "acp" as const, sessionId: "parent" };
const draft = (overrides: Partial<DelegationCreate> = {}): DelegationCreate => ({
  ...parent,
  requestId: uuidv7(),
  title: "调查",
  task: "检查实现",
  background: "只传必要上下文",
  constraints: "不能提交",
  expectedResult: "给出证据",
  intent: "analysis",
  dependsOn: [],
  execution: { kind: "acp", agent: "codex", config: [] },
  ...overrides,
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-delegation-"));
  const running: Array<{ task: DelegationTask; finish(): void; signal: AbortSignal }> = [];
  const delivered: string[] = [];
  let busy = true;
  let available = true;
  const service = new AgentDelegationService({
    path: join(dir, "delegations.sqlite"),
    targets: async () => [{ agent: "codex", ready: true, enabled: available }],
    execute: async (task, context) => {
      await context.update({
        session: { kind: "acp", id: task.session?.id ?? `child-${task.id}` },
      });
      await context.update({ status: "running" });
      await new Promise<void>((resolve) =>
        running.push({ task, finish: resolve, signal: context.signal }),
      );
      return {
        conclusion: "完成",
        changedFiles: [],
        tests: ["fake test"],
        risks: [],
        blockers: [],
        structured: true,
      };
    },
    deliver: async (_task, commandId) => {
      if (busy) return false;
      delivered.push(commandId);
      return true;
    },
  });
  return {
    service,
    running,
    delivered,
    idle() {
      busy = false;
    },
    disable() {
      available = false;
    },
    async dispose() {
      await service.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function flush(f: Awaited<ReturnType<typeof fixture>>) {
  await f.service.tick();
  await new Promise((resolve) => setImmediate(resolve));
}
test("child session membership survives retry and restart, scoped by workspace identity and path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-delegation-children-"));
  const path = join(dir, "delegations.sqlite");
  const repo = new DelegationRepository(path);
  const input = draft();
  const { workspacePath: _workspacePath, kind: _kind, sessionId: _sessionId, ...fields } = input;
  const task: DelegationTask = {
    ...fields,
    id: uuidv7(),
    parent,
    rootParent: parent,
    generation: 0,
    depth: 1,
    status: "failed",
    attempts: [],
    sessionRequestId: uuidv7(),
    session: { kind: "acp", id: "old-child" },
    createdAt: 1,
    updatedAt: 1,
  };
  try {
    await repo.open();
    repo.put(task);
    repo.put({ ...task, session: { kind: "acp", id: "new-child" } });
    repo.put({
      ...task,
      id: uuidv7(),
      requestId: uuidv7(),
      session: { kind: "acp", id: "worktree-child" },
      worktree: {
        rootPath: "/project",
        projectPath: "/project",
        path: "/project-worktree",
        branchName: "delegation-child",
        baseCommit: "abc123",
      },
    });
    repo.close();
    const reopened = new DelegationRepository(path);
    try {
      await reopened.open();
      assert.deepEqual(reopened.childSessionIds({ workspacePath: "/project" }, "acp"), [
        "new-child",
        "old-child",
      ]);
      assert.deepEqual(
        reopened.childSessionIds(
          { workspacePath: "/project", workspaceIdentity: "remote:other" },
          "acp",
        ),
        [],
      );
      assert.deepEqual(reopened.childSessionIds({ workspacePath: "/other" }, "acp"), []);
      assert.deepEqual(reopened.childSessionIds({ workspacePath: "/project" }, "api"), []);
      assert.deepEqual(reopened.childSessionIds({ workspacePath: "/project-worktree" }, "acp"), [
        "worktree-child",
      ]);
    } finally {
      reopened.close();
    }
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("archive removal guard observes queued descendants without canceling or delivering them", async () => {
  const f = await fixture();
  try {
    assert.equal(await f.service.hasPendingChildren(parent), false);
    await f.service.delegate(draft());
    assert.equal(await f.service.hasPendingChildren(parent), true);
    assert.equal(
      await f.service.hasPendingChildren({ ...parent, workspaceIdentity: "remote:other" }),
      false,
    );
    assert.deepEqual(f.delivered, []);
    assert.equal((await f.service.list(parent))[0]?.status, "queued");
    await f.service.cancelAll(parent);
    assert.equal(await f.service.hasPendingChildren(parent), false);
  } finally {
    await f.dispose();
  }
});
test("durable admission, two lanes, dependencies, follow-up and immutable results", async () => {
  const f = await fixture();
  try {
    const input = draft();
    const a = await f.service.delegate(input);
    assert.equal((await f.service.delegate(input)).id, a.id);
    const b = await f.service.delegate(draft());
    const c = await f.service.delegate(draft({ dependsOn: [a.id] }));
    await flush(f);
    assert.equal(f.running.length, 2);
    assert.deepEqual(
      new Set(await f.service.childSessionIds({ workspacePath: "/project" }, "acp")),
      new Set([`child-${a.id}`, `child-${b.id}`]),
    );
    assert.equal((await f.service.list(parent)).find((t) => t.id === c.id)?.status, "queued");
    f.running[0]!.finish();
    await flush(f);
    await flush(f);
    assert.equal(f.running.length, 3);
    assert.equal(f.delivered.length, 0);
    f.idle();
    await flush(f);
    assert.equal(f.delivered.length, 1);
    await flush(f);
    assert.equal(f.delivered.length, 1);
    const follow = await f.service.followUp({
      ...parent,
      id: a.id,
      requestId: uuidv7(),
      task: "继续复核",
    });
    assert.equal(follow.session?.id, `child-${a.id}`);
    assert.notEqual(follow.id, a.id);
    assert.equal(
      (await f.service.list(parent)).find((t) => t.id === a.id)?.attempts[0]?.result?.conclusion,
      "完成",
    );
    await assert.rejects(f.service.retry({ ...parent, id: b.id }), /not-retryable/);
    f.running.slice(1).forEach((r) => r.finish());
  } finally {
    f.running.forEach((r) => r.finish());
    await f.dispose();
  }
});
test("cancellation fences late results and parent stop prevents notifications", async () => {
  const f = await fixture();
  try {
    const task = await f.service.delegate(draft());
    await flush(f);
    await f.service.pauseParent(parent);
    assert.equal(f.running[0]?.signal.aborted, true);
    f.running[0]?.finish();
    f.idle();
    await flush(f);
    const stopped = (await f.service.list(parent))[0]!;
    assert.equal(stopped.status, "canceled");
    assert.equal(stopped.attempts[0]?.result, undefined);
    assert.equal(f.delivered.length, 0);
    await assert.rejects(f.service.resume({ ...parent, id: task.id }), /not-resumable/);
  } finally {
    f.running.forEach((r) => r.finish());
    await f.dispose();
  }
});
test("parent identity isolation, hidden unavailable agents, remote refusal", async () => {
  const f = await fixture();
  try {
    const task = await f.service.delegate(draft());
    assert.deepEqual(await f.service.list({ ...parent, workspaceIdentity: "another" }), []);
    await assert.rejects(
      f.service.cancel({ ...parent, sessionId: "other", id: task.id }),
      /not-found/,
    );
    await assert.rejects(
      f.service.delegate(draft({ workspaceIdentity: "remote:scope" })),
      /remote-unsupported/,
    );
    await assert.rejects(
      f.service.delegate(draft({ execution: { kind: "acp", agent: "claude", config: [] } })),
      /agent-unavailable/,
    );
  } finally {
    await f.dispose();
  }
});
test("accepted request stays idempotent after its agent is disabled", async () => {
  const f = await fixture();
  try {
    const input = draft();
    const accepted = await f.service.delegate(input);
    f.disable();
    assert.equal((await f.service.delegate(input)).id, accepted.id);
    await assert.rejects(f.service.delegate(draft()), /agent-unavailable/);
  } finally {
    await f.dispose();
  }
});
test("follow-up binding is committed before scheduling and old command cannot submit a result", async () => {
  const f = await fixture();
  const listener = f.service.onDynamicChanged(parent)(() => {
    void f.service.tick();
  });
  try {
    const task = await f.service.delegate(draft());
    await flush(f);
    f.running[0]!.finish();
    await flush(f);
    const follow = await f.service.followUp({
      ...parent,
      id: task.id,
      requestId: uuidv7(),
      task: "追问",
    });
    await flush(f);
    assert.equal(f.running[1]!.task.session?.id, `child-${task.id}`);
    assert.equal(
      (await f.service.list(parent)).find((t) => t.id === follow.id)?.session?.id,
      `child-${task.id}`,
    );
    await assert.rejects(
      f.service.submitResult(follow.id, f.running[0]!.task.attempts[0]!.commandId, {
        conclusion: "旧结果",
      }),
      /stale-attempt/,
    );
    await f.service.cancel({ ...parent, id: follow.id });
    await assert.rejects(
      f.service.submitResult(follow.id, f.running[1]!.task.attempts[0]!.commandId, {
        conclusion: "取消后结果",
      }),
      /stale-attempt/,
    );
  } finally {
    listener.dispose();
    f.running.forEach((r) => r.finish());
    await f.dispose();
  }
});
test("nested scheduling reserves capacity for children", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.service.updateSettings({
        workspacePath: parent.workspacePath,
        concurrency: 1,
        allowNested: true,
        maxDepth: 2,
      }),
    );
    await f.service.updateSettings({
      workspacePath: parent.workspacePath,
      concurrency: 2,
      allowNested: true,
      maxDepth: 2,
    });
    const a = await f.service.delegate(draft());
    await f.service.delegate(draft());
    await flush(f);
    assert.equal(f.running.length, 1);
    await f.service.delegate(draft({ sessionId: `child-${a.id}` }));
    await flush(f);
    assert.equal(f.running.length, 2);
    assert.equal(f.running[1]!.task.depth, 2);
  } finally {
    f.running.forEach((r) => r.finish());
    await f.dispose();
  }
});

test("canceling a task recursively stops children and suppresses already completed child results", async () => {
  const f = await fixture();
  try {
    await f.service.updateSettings({
      workspacePath: parent.workspacePath,
      concurrency: 3,
      allowNested: true,
      maxDepth: 2,
    });
    const root = await f.service.delegate(draft());
    await flush(f);
    const childParent = { ...parent, sessionId: `child-${root.id}` };
    const completed = await f.service.delegate(draft(childParent));
    const running = await f.service.delegate(draft(childParent));
    await flush(f);
    f.running.find((r) => r.task.id === completed.id)!.finish();
    await flush(f);
    assert.equal(
      (await f.service.list(childParent)).find((t) => t.id === completed.id)?.status,
      "completed",
    );
    await f.service.cancel({ ...parent, id: root.id });
    const children = await f.service.list(childParent);
    assert.equal(children.find((t) => t.id === running.id)?.status, "canceled");
    assert.equal(children.find((t) => t.id === completed.id)?.attempts[0]?.delivery, "suppressed");
    assert.equal(
      children.find((t) => t.id === completed.id)?.attempts[0]?.result?.conclusion,
      "完成",
    );
    f.idle();
    await flush(f);
    assert.equal(f.delivered.length, 0);
  } finally {
    f.running.forEach((r) => r.finish());
    await f.dispose();
  }
});
