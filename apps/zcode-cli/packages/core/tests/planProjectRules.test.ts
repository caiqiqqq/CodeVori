import assert from "node:assert/strict";
import test from "node:test";
import { createRootTraceContext } from "@zcode/contracts";
import { PermissionService } from "../src/permission/service.js";
import { resolveToolPermission } from "../src/tool/executor/permission-flow.js";
import type { ToolExecutorDeps } from "../src/tool/executor/types.js";
import { bashToolEntry } from "../src/tool/handlers/bash.js";
import type { ToolEntry } from "../src/tool/types.js";

for (const mode of ["build", "edit", "plan", "guarded", "yolo"] as const) {
  test(`Plan rejects project-ask destructive tools in ${mode}`, () => {
    const service = new PermissionService();
    for (const toolName of ["Bash", "mcp__fixture__delete"]) {
      const decision = service.checkPermission(
        { toolName, input: {}, mode, planEnabled: true, riskLevel: "high" },
        { destructive: true, readOnly: false, needsApproval: true },
        { version: 1, ask: [{ toolName }] },
      );
      assert.equal(decision.decision, "deny");
      assert.equal(decision.ruleId, "mode.plan.nonReadOnly");
    }
    assert.equal(
      service.checkPermission(
        { toolName: "Read", input: {}, mode, planEnabled: true, riskLevel: "low" },
        { readOnly: true, destructive: false, needsApproval: false },
        { version: 1, ask: [{ toolName: "Read" }] },
      ).decision,
      "ask",
    );
  });
}

test("Guarded plus Plan keeps dangerous MCP approval single-use despite a project ask", () => {
  const decision = new PermissionService().checkPermission(
    {
      toolName: "mcp__fixture__write",
      input: {},
      mode: "guarded",
      planEnabled: true,
      riskLevel: "high",
    },
    {
      permission: { permission: "mcp" } as never,
      destructive: false,
      userApprovalRule: "dangerous.fixture",
    },
    { version: 1, ask: [{ toolName: "mcp__fixture__write" }] },
  );
  assert.equal(decision.decision, "ask");
  assert.equal(decision.approvalMode, "user-once");
});

test("project ask cannot bypass Plan's MCP user confirmation through hooks or prepareApproval", async () => {
  let asks = 0;
  let hooks = 0;
  let previews = 0;
  let grants = 0;
  const service = new PermissionService();
  service.grantSessionPermission = () => {
    grants++;
  };
  const deps = {
    sessionId: "plan-project-ask",
    permissionService: service,
    getMode: () => "build",
    getWorkingDirectory: () => "/fixture",
    getWorkspaceRoot: () => "/fixture",
    sessionModePort: { isPlanEnabled: () => true, getPrePlanMode: () => "build" },
    sessionStore: {
      getSession: async () => ({ projectID: "project" }),
      getProjectPermission: async () => ({
        version: 1,
        ask: [{ toolName: "mcp__fixture__write" }],
      }),
      saveProjectPermission: async () => {
        grants++;
      },
    },
    emitEvent: async () => {},
    hookRunner: {
      run: async () => {
        hooks++;
        throw Error("user confirmation required");
      },
    },
    permissionBroker: {
      requestPermission: async (request: { optionsPolicy?: string }) => {
        asks++;
        assert.equal(request.optionsPolicy, "no-always-allow");
        const grant = { type: "addRules", behavior: "allow", rules: [{ toolName: "mcp" }] };
        return { decision: "allow", permissionUpdates: [grant], sessionPermissionUpdates: [grant] };
      },
    },
  } as unknown as ToolExecutorDeps;
  const entry = {
    ...bashToolEntry,
    resolvePermissionCapability: undefined,
    permission: {
      permission: "mcp",
      reason: "fixture",
      riskLevel: "medium",
      sideEffectScope: "network",
      needsApproval: true,
      patternSources: [],
      denyPriority: "beforeAsk",
    },
    metadata: {
      ...bashToolEntry.metadata,
      destructive: false,
      readOnly: false,
      needsApproval: true,
    },
    prepareApproval: () => {
      previews++;
      return { gate: "proceed" };
    },
  } as ToolEntry;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await resolveToolPermission(
      deps,
      { id: `call-${attempt}`, name: "mcp__fixture__write", input: {} },
      entry,
      {},
      { additionalContexts: [], permissionBehavior: "allow" },
      "build",
      createRootTraceContext(),
    );
    assert.equal(result.allowed, true);
  }
  const destructive = await resolveToolPermission(
    deps,
    { id: "destructive", name: "mcp__fixture__write", input: {} },
    { ...entry, metadata: { ...entry.metadata, destructive: true } },
    {},
    { additionalContexts: [], permissionBehavior: "allow" },
    "build",
    createRootTraceContext(),
  );
  assert.equal(destructive.allowed, false);
  assert.equal(asks, 2);
  assert.equal(hooks, 0);
  assert.equal(previews, 0);
  assert.equal(grants, 0);
});
