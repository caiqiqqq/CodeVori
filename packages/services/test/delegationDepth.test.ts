import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  uuidv7,
  type DelegationApiAgent,
  type DelegationParent,
  type DelegationTask,
  type NativeMcpServerRecord,
} from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp } from "../src/delegation/delegationMcp.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-depth-"));
  const parent: DelegationParent = { workspacePath: directory, kind: "acp", sessionId: "parent" };
  const api: DelegationApiAgent = {
    kind: "api",
    providerName: "Fixture API",
    execution: {
      kind: "api",
      mode: "build",
      modelSelection: {
        providerId: "fixture",
        modelId: "model",
        options: { reasoningLevel: "high" },
      },
    },
    reasoningLevels: ["high"],
  };
  const runs: Array<{ task: DelegationTask; finish(): void }> = [];
  const createService = () =>
    new AgentDelegationService({
      path: join(directory, "tasks.sqlite"),
      targets: async () => [{ agent: "codex", ready: true, enabled: true }],
      apiTargets: async () => [api],
      execute: async (task, context) => {
        await context.update({ session: { kind: task.execution.kind, id: `child-${task.id}` } });
        await context.update({ status: "running" });
        await new Promise<void>((resolve) => runs.push({ task, finish: resolve }));
        return {
          conclusion: "fixture result",
          changedFiles: [],
          tests: [],
          risks: [],
          blockers: [],
          structured: true,
        };
      },
      deliver: async () => false,
    });
  const service = createService();
  const bridge = createDelegationMcp(directory, service);
  const delegate = (scope = parent, useApi = false) =>
    service.delegate({
      ...scope,
      requestId: uuidv7(),
      title: "Depth fixture",
      task: "Check delegation depth",
      background: "",
      constraints: "",
      expectedResult: "",
      intent: "analysis",
      dependsOn: [],
      execution: useApi ? api.execution : { kind: "acp", agent: "codex", config: [] },
    });
  return {
    parent,
    service,
    bridge,
    runs,
    createService,
    delegate,
    async flush() {
      await service.tick();
      await new Promise((resolve) => setImmediate(resolve));
    },
    async dispose() {
      runs.forEach((run) => run.finish());
      bridge.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function toolNames(record: NativeMcpServerRecord) {
  const response = await fetch(record.config.env!.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${record.config.env!.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { result: { tools: Array<{ name: string }> } };
  return data.result.tools.map((tool) => tool.name);
}

test("depth settings persist from 1 to 8 and remain scoped and strictly validated", async () => {
  const f = await fixture();
  let reopened: AgentDelegationService | undefined;
  try {
    assert.equal((await f.service.getSettings(f.parent)).allowNested, false);
    const global = { workspacePath: "__global__", concurrency: 8, allowNested: true, maxDepth: 8 };
    await f.service.updateSettings(global);
    const scope = { workspacePath: f.parent.workspacePath, workspaceIdentity: "workspace-a" };
    await f.service.updateSettings({ ...scope, concurrency: 5, allowNested: true, maxDepth: 5 });
    assert.equal((await f.service.getSettings(scope)).maxDepth, 5);
    assert.equal(
      (await f.service.getSettings({ ...scope, workspaceIdentity: "workspace-b" })).maxDepth,
      8,
    );
    for (const maxDepth of [0, 9, 1.5]) {
      await assert.rejects(f.service.updateSettings({ ...global, maxDepth }));
    }
    await assert.rejects(
      f.service.updateSettings({ ...global, concurrency: 7 }),
      /nesting-capacity/,
    );
    await f.service.disposeAllAndWait();
    reopened = f.createService();
    assert.deepEqual(await reopened.getSettings(f.parent), {
      enabled: true,
      completedCacheMaxMb: 512,
      concurrency: 8,
      allowNested: true,
      maxDepth: 8,
    });
    assert.equal((await reopened.getSettings(scope)).maxDepth, 5);
  } finally {
    await reopened?.disposeAllAndWait();
    await f.dispose();
  }
});

for (const allowNested of [false, true]) {
  test(`one effective layer rejects nesting with allowNested=${allowNested}`, async () => {
    const f = await fixture();
    try {
      await f.service.updateSettings({ ...f.parent, concurrency: 2, allowNested, maxDepth: 1 });
      const task = await f.delegate();
      await f.flush();
      assert.equal(task.depth, 1);
      const child = { ...f.parent, sessionId: `child-${task.id}` };
      await assert.rejects(f.delegate(child, true), /nesting-disabled/);
      const registration = (await f.bridge.register(child))!;
      assert.equal(registration.canDelegate, false);
      assert.deepEqual(await toolNames(registration.record), ["SubmitDelegationResult"]);
    } finally {
      await f.dispose();
    }
  });
}

test("mixed API and ACP chain reaches eight layers without starving children; ninth is rejected", async () => {
  const f = await fixture();
  try {
    await f.service.updateSettings({ ...f.parent, concurrency: 8, allowNested: true, maxDepth: 8 });
    let parent = f.parent;
    for (let depth = 1; depth <= 8; depth++) {
      const task = await f.delegate(parent, depth % 2 === 0);
      if (depth === 1) await f.delegate();
      await f.flush();
      assert.equal(task.depth, depth);
      assert.equal(
        f.runs.length,
        depth,
        "a queued root cannot take capacity reserved for children",
      );
      parent = { ...f.parent, kind: task.execution.kind, sessionId: `child-${task.id}` };
      const registration = (await f.bridge.register(parent))!;
      assert.equal(registration.canDelegate, depth < 8);
      const tools = await toolNames(registration.record);
      assert.equal(tools.includes("SubmitDelegationResult"), true);
      assert.equal(tools.includes("DelegateTask"), depth < 8);
    }
    await assert.rejects(f.delegate(parent), /nesting-disabled/);
  } finally {
    await f.dispose();
  }
});

for (const allowNested of [false, true]) {
  test(`lowering live limits preserves already accepted children with allowNested=${allowNested}`, async () => {
    const f = await fixture();
    try {
      await f.service.updateSettings({
        ...f.parent,
        concurrency: 3,
        allowNested: true,
        maxDepth: 3,
      });
      const first = await f.delegate();
      await f.flush();
      const child = { ...f.parent, sessionId: `child-${first.id}` };
      const second = await f.delegate(child);
      await f.flush();
      const grandchild = { ...f.parent, sessionId: `child-${second.id}` };
      const accepted = await f.delegate(grandchild, true);
      const queuedRoot = await f.delegate();
      await f.service.updateSettings({ ...f.parent, concurrency: 1, allowNested, maxDepth: 1 });
      await assert.rejects(f.delegate(grandchild), /nesting-disabled/);
      await f.flush();
      assert.equal(f.runs.length, 3);
      assert.equal(f.runs[2]!.task.id, accepted.id);
      assert.equal(
        (await f.service.list(f.parent)).find((task) => task.id === queuedRoot.id)?.status,
        "queued",
      );
      f.runs.forEach((run) => run.finish());
      await f.flush();
      await f.flush();
      assert.equal(f.runs.length, 4);
      assert.equal(f.runs[3]!.task.id, queuedRoot.id);
      assert.equal((await f.service.getSettings(f.parent)).concurrency, 1);
    } finally {
      await f.dispose();
    }
  });
}
