import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegationSettingsSchema, uuidv7, type DelegationCreate } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp } from "../src/delegation/delegationMcp.js";
import { DelegationRepository } from "../src/delegation/delegationRepository.js";

test("legacy settings gain defaults; old writes preserve enabled and cache preferences", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-settings-"));
  const scope = { workspacePath: directory };
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [],
    execute: async () => {
      throw new Error("unused");
    },
    deliver: async () => false,
  });
  try {
    assert.deepEqual(delegationSettingsSchema.parse({}), {
      enabled: true,
      concurrency: 2,
      allowNested: false,
      maxDepth: 2,
      completedCacheMaxMb: 512,
    });
    const legacy = { concurrency: 2, allowNested: false, maxDepth: 2 };
    assert.equal(delegationSettingsSchema.parse(legacy).enabled, true);
    await service.updateSettings({ ...scope, ...legacy, enabled: false, completedCacheMaxMb: 0 });
    await service.updateSettings({ ...scope, ...legacy, concurrency: 3 } as never);
    assert.equal((await service.getSettings(scope)).enabled, false);
    assert.equal((await service.getSettings(scope)).completedCacheMaxMb, 0);
    for (const completedCacheMaxMb of [null, -1, 1.5, 4_294_967_296]) {
      await assert.rejects(
        service.updateSettings({
          ...scope,
          ...legacy,
          enabled: true,
          completedCacheMaxMb,
        } as never),
      );
    }
    for (const enabled of [null, "false", 0])
      await assert.rejects(
        service.updateSettings({ ...scope, ...legacy, enabled, completedCacheMaxMb: 512 } as never),
      );
    await service.disposeAllAndWait();
    const repo = new DelegationRepository(join(directory, "tasks.sqlite"));
    await repo.open();
    try {
      assert.equal(repo.settings(scope).enabled, false);
      assert.equal(repo.settings(scope).completedCacheMaxMb, 0);
    } finally {
      repo.close();
    }
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const kind of ["api", "acp"] as const) {
  test(`${kind}: disabling hides new MCP, rejects admissions but preserves accepted tasks and result tools`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-toggle-"));
    const parent = { workspacePath: directory, kind, sessionId: "parent" };
    const input: DelegationCreate = {
      ...parent,
      requestId: uuidv7(),
      title: "设置验证",
      task: "验证主开关",
      background: "",
      constraints: "",
      expectedResult: "",
      intent: "analysis",
      dependsOn: [],
      execution: { kind: "acp", agent: "codex", config: [] },
    };
    const service = new AgentDelegationService({
      path: join(directory, "tasks.sqlite"),
      targets: async () => [{ agent: "codex", ready: true, enabled: true }],
      execute: async (task, context) => {
        await context.update({ session: { kind: "acp", id: `child-${task.id}` } });
        throw new Error("fixture failure");
      },
      deliver: async () => false,
    });
    const bridge = createDelegationMcp(directory, service);
    try {
      const oldRegistration = (await bridge.register(parent))!;
      const task = await service.delegate(input);
      await service.updateSettings({
        ...parent,
        ...(await service.getSettings(parent)),
        enabled: false,
      });
      assert.equal(
        (await service.delegate(input)).id,
        task.id,
        "accepted request remains idempotent",
      );
      await assert.rejects(
        service.delegate({ ...input, requestId: uuidv7() }),
        /delegation.disabled/,
      );
      assert.equal(await bridge.register({ ...parent, sessionId: "new-parent" }), undefined);
      const env = oldRegistration.record.config.env!;
      const call = async (name: string, args: unknown) => {
        const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        });
        assert.equal(response.status, 200);
        return (await response.json()) as {
          result: { isError?: boolean; content: Array<{ text: string }> };
        };
      };
      const denied = await call("DelegateTask", {
        title: input.title,
        task: input.task,
        execution: input.execution,
        requestId: uuidv7(),
      });
      assert.equal(denied.result.isError, true);
      assert.match(denied.result.content[0]!.text, /delegation.disabled/);
      await service.tick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        (await service.list(parent))[0]!.status,
        "failed",
        "queued accepted work was executed",
      );
      const child = (await bridge.register({
        ...parent,
        kind: "acp",
        sessionId: `child-${task.id}`,
      }))!;
      assert.equal(child.canDelegate, false);
      const childEnv = child.record.config.env!;
      const tools = (await fetch(childEnv.ZCODE_WORKFLOW_URL!, {
        method: "POST",
        headers: {
          authorization: `Bearer ${childEnv.ZCODE_WORKFLOW_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }).then((r) => r.json())) as { result: { tools: Array<{ name: string }> } };
      assert.deepEqual(
        tools.result.tools.map((t) => t.name),
        ["SubmitDelegationResult"],
      );
      await assert.rejects(
        service.followUp({ ...parent, id: task.id, requestId: uuidv7(), task: "继续" }),
        /delegation.disabled/,
      );
      await assert.rejects(service.retry({ ...parent, id: task.id }), /delegation.disabled/);
      const repo = new DelegationRepository(join(directory, "tasks.sqlite"));
      await repo.open();
      try {
        const interrupted = repo.get(task.id)!;
        interrupted.status = "interrupted";
        repo.put(interrupted);
      } finally {
        repo.close();
      }
      await assert.rejects(service.resume({ ...parent, id: task.id }), /delegation.disabled/);
      assert.equal((await call("ListDelegationTasks", {})).result.isError, undefined);
      assert.equal((await call("CancelDelegation", { id: task.id })).result.isError, undefined);
      await service.updateSettings({
        ...parent,
        ...(await service.getSettings(parent)),
        enabled: true,
      });
      assert.equal(
        (await bridge.register({ ...parent, sessionId: "reenabled" }))!.canDelegate,
        true,
      );
    } finally {
      bridge.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("disabling during asset validation is fenced; already running work can still submit and finish", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-toggle-race-"));
  const parent = { workspacePath: directory, kind: "api" as const, sessionId: "parent" };
  let releaseAssets!: () => void;
  let finish!: () => void;
  let holdAssets = false;
  const result = {
    conclusion: "完成",
    tests: [],
    changedFiles: [],
    risks: [],
    blockers: [],
    structured: true,
  };
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "codex", ready: true, enabled: true }],
    validateAssets: async () => {
      if (holdAssets) await new Promise<void>((resolve) => (releaseAssets = resolve));
    },
    execute: async (_task, context) => {
      await context.update({ status: "running" });
      await new Promise<void>((resolve) => (finish = resolve));
      return result;
    },
    deliver: async () => false,
  });
  const input = () => ({
    ...parent,
    requestId: uuidv7(),
    title: "检查",
    task: "检查",
    background: "",
    constraints: "",
    expectedResult: "",
    intent: "analysis" as const,
    dependsOn: [],
    execution: { kind: "acp" as const, agent: "codex" as const, config: [] },
  });
  try {
    const accepted = await service.delegate(input());
    await service.tick();
    await new Promise((resolve) => setImmediate(resolve));
    holdAssets = true;
    const pending = service.delegate(input());
    await new Promise((resolve) => setImmediate(resolve));
    await service.updateSettings({
      ...parent,
      ...(await service.getSettings(parent)),
      enabled: false,
    });
    const rejected = assert.rejects(pending, /delegation.disabled/);
    releaseAssets();
    await rejected;
    const running = (await service.list(parent))[0]!;
    assert.equal(running.status, "running");
    await service.submitResult(accepted.id, running.attempts.at(-1)!.commandId, result);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    const tasks = await service.list(parent);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.status, "completed");
    assert.deepEqual(tasks[0]!.attempts.at(-1)!.result, result);
  } finally {
    finish?.();
    releaseAssets?.();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
