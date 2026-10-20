import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, type DelegationTask, type DelegationResult } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { DelegationRepository } from "../src/delegation/delegationRepository.js";

const parent = { workspacePath: "/recovery", kind: "api" as const, sessionId: "parent" };
const draft = () => ({
  ...parent,
  requestId: uuidv7(),
  title: "恢复测试",
  task: "只分析",
  background: "",
  constraints: "",
  expectedResult: "",
  execution: { kind: "acp" as const, agent: "codex", config: [] },
  intent: "analysis" as const,
  dependsOn: [],
});
const result: DelegationResult = {
  conclusion: "真实结果",
  changedFiles: [],
  tests: [],
  risks: [],
  blockers: [],
  structured: true,
};
const drain = () => new Promise((resolve) => setImmediate(resolve));

test("two coordinators claim once; expired lease becomes interrupted without replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-recovery-"));
  const path = join(directory, "tasks.sqlite");
  const executions: DelegationTask[] = [];
  const resolvers: Array<() => void> = [];
  const deps = {
    path,
    targets: async () => [{ agent: "codex" as const, ready: true, enabled: true }],
    execute: async (task: DelegationTask) => {
      executions.push(task);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return result;
    },
    deliver: async () => false,
  };
  const first = new AgentDelegationService(deps);
  const second = new AgentDelegationService(deps);
  const repo = new DelegationRepository(path);
  try {
    const task = await first.delegate(draft());
    await first.tick();
    await second.tick();
    assert.equal(executions.length, 1);
    await repo.open();
    repo.transaction(() => {
      const current = repo.get(task.id)!;
      current.leaseUntil = 0;
      repo.put(current);
    });
    await second.tick();
    assert.equal((await second.list(parent))[0]!.status, "interrupted");
    assert.equal(executions.length, 1);
    resolvers[0]!();
    await drain();
    assert.equal(
      (await first.list(parent))[0]!.status,
      "interrupted",
      "late completion cannot reclaim ownership",
    );
    const resumed = await second.resume({ ...parent, id: task.id });
    assert.equal(resumed.attempts.length, 1);
    await second.tick();
    assert.equal(executions.length, 2);
    assert.equal(executions[1]!.attempts.length, 2);
    assert.notEqual(executions[0]!.attempts[0]!.commandId, executions[1]!.attempts[1]!.commandId);
  } finally {
    resolvers.forEach((resolve) => resolve());
    await first.disposeAllAndWait();
    await second.disposeAllAndWait();
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("uncertain outbox is not replayed after restart and needs explicit redelivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-outbox-"));
  const path = join(directory, "tasks.sqlite");
  const commands: string[] = [];
  let broken = true;
  const deps = {
    path,
    targets: async () => [{ agent: "codex" as const, ready: true, enabled: true }],
    execute: async () => result,
    deliver: async (_task: DelegationTask, commandId: string) => {
      commands.push(commandId);
      if (broken) throw new Error("connection lost after admission");
      return true;
    },
  };
  let service = new AgentDelegationService(deps);
  try {
    const task = await service.delegate(draft());
    await service.tick();
    await drain();
    await service.tick();
    await drain();
    assert.equal((await service.list(parent))[0]!.attempts[0]!.delivery, "uncertain");
    assert.equal(commands.length, 1);
    await service.disposeAllAndWait();
    service = new AgentDelegationService(deps);
    broken = false;
    await service.tick();
    await drain();
    assert.equal(commands.length, 1);
    await service.redeliver({ ...parent, id: task.id });
    await service.tick();
    await drain();
    assert.equal(commands.length, 2);
    assert.notEqual(commands[0], commands[1]);
    assert.equal((await service.list(parent))[0]!.attempts[0]!.delivery, "delivered");
    await service.pauseParent(parent);
    await assert.rejects(
      service.beforeParentCommand(parent, "sendText", commands[1]!),
      /parent-stopped/,
    );
    await service.armParent(parent);
    await assert.rejects(
      service.beforeParentCommand(parent, "sendText", commands[1]!),
      /parent-stopped/,
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("multi-window delivery is exclusive and heartbeats do not wait for slow admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-delivery-"));
  const path = join(directory, "tasks.sqlite");
  let resolveDelivery!: (accepted: boolean) => void;
  let deliveries = 0;
  const deps = {
    path,
    targets: async () => [{ agent: "codex" as const, ready: true, enabled: true }],
    execute: async () => result,
    deliver: async () => {
      deliveries++;
      return new Promise<boolean>((resolve) => {
        resolveDelivery = resolve;
      });
    },
  };
  const first = new AgentDelegationService(deps);
  const second = new AgentDelegationService(deps);
  try {
    await first.delegate(draft());
    await first.tick();
    await drain();
    await first.tick();
    await drain();
    assert.equal(deliveries, 1);
    await second.tick();
    assert.equal(deliveries, 1);
    await first.tick();
    await first.pauseParent(parent);
    resolveDelivery(true);
    await drain();
    assert.equal((await first.list(parent))[0]!.attempts[0]!.delivery, "suppressed");
  } finally {
    resolveDelivery?.(false);
    await first.disposeAllAndWait();
    await second.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted admission order does not depend on UUID suffixes and survives updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-order-"));
  const path = join(directory, "tasks.sqlite");
  const service = new AgentDelegationService({
    path,
    targets: async () => [{ agent: "codex", ready: true, enabled: true }],
    execute: async () => result,
    deliver: async () => false,
  });
  const repo = new DelegationRepository(path);
  try {
    const template = await service.delegate(draft());
    await repo.open();
    const now = Date.now();
    const first = { ...template, id: uuidv7(now + 1), requestId: uuidv7() };
    const second = { ...template, id: uuidv7(now), requestId: uuidv7() };
    repo.transaction(() => {
      repo.put(first);
      repo.put(second);
      repo.put({ ...first, title: "更新不改变次序" });
    });
    assert.deepEqual(
      repo
        .list(parent)
        .slice(1)
        .map((t) => t.id),
      [first.id, second.id],
    );
  } finally {
    repo.close();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("retry does not strand the previous failed attempt outbox", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-attempts-"));
  let fail = true;
  let busy = true;
  const commands: string[] = [];
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "codex", ready: true, enabled: true }],
    execute: async () => {
      if (fail) throw new Error("first attempt failed");
      return result;
    },
    deliver: async (_task, commandId) => {
      if (busy) return false;
      commands.push(commandId);
      return true;
    },
  });
  try {
    const task = await service.delegate(draft());
    await service.tick();
    await drain();
    assert.equal((await service.list(parent))[0]?.status, "failed");
    await service.retry({ ...parent, id: task.id });
    fail = false;
    await service.tick();
    await drain();
    busy = false;
    await service.tick();
    await drain();
    await service.tick();
    await drain();
    const attempts = (await service.list(parent))[0]!.attempts;
    assert.deepEqual(
      attempts.map((a) => a.delivery),
      ["delivered", "delivered"],
    );
    assert.deepEqual(
      commands,
      attempts.map((a) => a.deliveryCommandId),
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("repeated shutdown shares one completion and never reopens a closed database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-dispose-"));
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [],
    execute: async () => result,
    deliver: async () => false,
  });
  try {
    const first = service.disposeAllAndWait();
    assert.equal(service.disposeAllAndWait(), first);
    await first;
    await service.disposeAllAndWait();
    assert.equal(service.disposeAllAndWait(), first);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
