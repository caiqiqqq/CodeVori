import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectMemoryToolEntries } from "../src/memory/project-memory-tools.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { openProjectMemoryStore } from "@zcode/shared/node";
import { initializeRuntimeTooling } from "../src/runtime/helpers/runtime-tools.js";
import { ToolRegistryImpl } from "../src/tool/registry.js";
import { applyMemoryFilePermission } from "../src/tool/executor/memory-file-permission.js";
import type { PermissionDecisionResult } from "../src/permission/service.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import type { AgentRuntimeDeps } from "../src/runtime/types.js";
import { createMemoryExtractionScheduler } from "../src/memory/extraction.js";
import type { MemoryExtractionSnapshot } from "../src/memory/extraction.js";

test("native API tools return the same receipt and revision as the shared project store", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-memory-tool-"));
  const scope = {
    cliStorageRoot: join(root, "cli"),
    workspacePath: root,
    workspaceIdentity: "fixture:a",
  };
  const context = { abortSignal: new AbortController().signal } as ToolExecutionContext;
  try {
    const tools = createProjectMemoryToolEntries(() => scope);
    const read = tools.find((tool) => tool.metadata.name === "ReadProjectMemory")!;
    const save = tools.find((tool) => tool.metadata.name === "SaveProjectMemory")!;
    const saved = (await save.handler(
      {
        name: "routing-rule",
        type: "feedback",
        description: "路由规则",
        content: "委派时保持主智能体。",
        expectedRevision: null,
      },
      context,
    )) as { revision: string; status: string };
    assert.equal(saved.status, "saved");
    assert.equal(
      ((await read.handler({ name: "routing-rule" }, context)) as { revision: string }).revision,
      saved.revision,
    );
    const store = await openProjectMemoryStore(scope);
    assert.equal((await store.read({ name: "routing-rule" })).revision, saved.revision);
    await assert.rejects(
      save.handler(
        {
          name: "routing-rule",
          type: "feedback",
          description: "路由规则",
          content: "过期的新内容。",
          expectedRevision: null,
        },
        context,
      ),
      /revision conflict/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime registration respects memory settings, task scope and disallowed tools", () => {
  const registryFor = (memoryEnabled: boolean, taskType?: string, toolDisallowlist?: string[]) => {
    const registry = new ToolRegistryImpl();
    const runtime = {
      config: {
        taskType,
        toolDisallowlist,
        memory: { enabled: memoryEnabled, cliStorageRoot: "/fixture" },
      },
      registry,
      isRemoteWorkspace: () => false,
    } as unknown as AgentRuntimeInternal;
    initializeRuntimeTooling(runtime, { toolExecutor: {} } as AgentRuntimeDeps, "fixture" as never);
    return registry;
  };
  assert.equal(registryFor(true).has("SaveProjectMemory"), true);
  assert.equal(registryFor(false).has("SaveProjectMemory"), false);
  assert.equal(registryFor(true, "subagent_child").has("SaveProjectMemory"), false);
  assert.equal(registryFor(true, undefined, ["SaveProjectMemory"]).has("SaveProjectMemory"), false);
});

test("project save shares legacy memory permissions while preserving explicit denies", () => {
  const input = {
    executionInput: { name: "routing-rule" },
    memoryRoot: "/fixture/memory",
    toolName: "SaveProjectMemory",
    workingDirectory: "/fixture",
    workspaceRoot: "/fixture",
  };
  const plan = {
    allowed: false,
    decision: "deny",
    ruleId: "mode.plan.nonReadOnly",
  } as PermissionDecisionResult;
  assert.equal(applyMemoryFilePermission({ ...input, decision: plan }).allowed, true);
  assert.equal(
    applyMemoryFilePermission({ ...input, decision: { ...plan, ruleId: "rule.project.deny" } })
      .allowed,
    false,
  );
  assert.equal(
    applyMemoryFilePermission({ ...input, executionInput: { name: "../outside" }, decision: plan })
      .allowed,
    false,
  );
});

test("a completed native save suppresses background extraction of that turn", async () => {
  let calls = 0;
  const scheduler = createMemoryExtractionScheduler(async () => {
    calls++;
    return "success";
  });
  scheduler.schedule({
    boundaryMessageId: "last",
    memoryRoot: "/fixture/memory",
    workingDirectory: "/fixture",
    workspaceRoot: "/fixture",
    durableMessages: [
      {
        info: { id: "last", role: "assistant" },
        parts: [
          { type: "tool", tool: "SaveProjectMemory", state: { status: "completed", input: {} } },
        ],
      },
    ],
  } as unknown as MemoryExtractionSnapshot);
  await scheduler.drain();
  assert.equal(calls, 0);
});
