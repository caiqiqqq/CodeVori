import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegationTaskSchema, uuidv7 } from "@zcode/shared";
import { DelegationResultCache } from "../src/delegation/delegationResultCache.js";
import { DelegationRepository, parentKey } from "../src/delegation/delegationRepository.js";

function snapshot(sessionId = "parent", large = false) {
  const parent = { workspacePath: "/fixture", kind: "acp", sessionId };
  const task = delegationTaskSchema.parse({
    id: uuidv7(),
    requestId: uuidv7(),
    parent,
    rootParent: parent,
    generation: 0,
    depth: 1,
    title: "缓存验证",
    task: "检查结果",
    background: "",
    constraints: "",
    expectedResult: "",
    execution: { kind: "acp", agent: "codex", config: [] },
    intent: "analysis",
    dependsOn: [],
    status: "completed",
    sessionRequestId: uuidv7(),
    createdAt: 1,
    updatedAt: 2,
    attempts: [
      {
        sequence: 1,
        commandId: uuidv7(),
        status: "completed",
        startedAt: 1,
        endedAt: 2,
        deliveryCommandId: uuidv7(),
        result: { conclusion: "已核对", tests: large ? Array(70).fill("x".repeat(10_000)) : [] },
      },
    ],
  });
  return { task, data: JSON.stringify(task) };
}

test("completed snapshots evict oldest per parent and return isolated copies", () => {
  const cache = new DelegationResultCache();
  const a = snapshot("a", true),
    b = snapshot("a", true),
    other = snapshot("b", true);
  cache.set(parentKey(a.task.rootParent), a.task, a.data, 1);
  cache.set(parentKey(other.task.rootParent), other.task, other.data, 1);
  cache.set(parentKey(b.task.rootParent), b.task, b.data, 1);
  assert.equal(cache.get(a.task.id, a.data), undefined);
  assert.ok(cache.get(other.task.id, other.data));
  const value = cache.get(b.task.id, b.data)!;
  value.attempts[0]!.result!.conclusion = "修改副本";
  assert.equal(cache.get(b.task.id, b.data)!.attempts[0]!.result!.conclusion, "已核对");
  assert.equal(
    cache.get(b.task.id, b.data + " "),
    undefined,
    "serialized version fences cross-host writes",
  );
});

test("unlimited, lower budgets, oversized snapshots and cleanup preserve only derived data", () => {
  const cache = new DelegationResultCache();
  const a = snapshot("a", true),
    b = snapshot("a", true);
  cache.set(parentKey(a.task.rootParent), a.task, a.data, 0);
  cache.set(parentKey(b.task.rootParent), b.task, b.data, 0);
  assert.ok(cache.get(a.task.id, a.data));
  cache.set(parentKey(b.task.rootParent), b.task, b.data, 1);
  assert.equal(cache.get(a.task.id, a.data), undefined);
  cache.clearParent(parentKey(b.task.rootParent));
  assert.equal(cache.get(b.task.id, b.data), undefined);
  a.task.attempts[0]!.result!.changedFiles = Array(150).fill("f".repeat(4000));
  const oversized = JSON.stringify(a.task);
  cache.set(parentKey(a.task.rootParent), a.task, oversized, 1);
  assert.equal(cache.get(a.task.id, oversized), undefined);
  cache.set(parentKey(b.task.rootParent), b.task, b.data, 1);
  cache.clear();
  assert.equal(cache.get(b.task.id, b.data), undefined);
});

test("repository cache follows cross-host writes, suspension and rollback without deleting results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-cache-"));
  const repo = new DelegationRepository(join(directory, "tasks.sqlite"));
  const other = new DelegationRepository(join(directory, "tasks.sqlite"));
  try {
    await repo.open();
    await other.open();
    const { task } = snapshot();
    repo.put(task);
    const first = repo.get(task.id)!;
    first.attempts[0]!.result!.conclusion = "调用方草稿";
    assert.equal(repo.get(task.id)!.attempts[0]!.result!.conclusion, "已核对");
    const updated = other.get(task.id)!;
    updated.attempts[0]!.result!.conclusion = "另一个 Host 的结果";
    other.put(updated);
    assert.equal(repo.get(task.id)!.attempts[0]!.result!.conclusion, "另一个 Host 的结果");
    assert.throws(
      () =>
        repo.transaction(() => {
          updated.attempts[0]!.result!.conclusion = "未提交结果";
          repo.put(updated);
          repo.get(task.id);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(repo.get(task.id)!.attempts[0]!.result!.conclusion, "另一个 Host 的结果");
    other.setParent(task.rootParent, { generation: 1, suspended: true });
    assert.equal(repo.list(task.parent)[0]!.status, "completed");
    const reopened = new DelegationRepository(join(directory, "tasks.sqlite"));
    await reopened.open();
    try {
      assert.equal(reopened.get(task.id)!.attempts[0]!.result!.conclusion, "另一个 Host 的结果");
    } finally {
      reopened.close();
    }
  } finally {
    repo.close();
    other.close();
    await rm(directory, { recursive: true, force: true });
  }
});
