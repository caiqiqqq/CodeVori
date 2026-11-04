import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionId,
  getCurrentModelInvocationContext,
  InMemorySessionEventStore,
  type Model,
  type ModelResult,
  type PermissionBrokerRequest,
} from "@zcode/contracts";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { PermissionService, defaultPermissionConfig } from "../src/permission/service.js";
import { restrictApprovalGrants } from "../src/tool/executor/approval-gate.js";

for (const mode of ["build", "edit", "plan"] as const) {
  test(`Plan preserves ${mode} approvals for MCP writes and WebFetch`, () => {
    const service = new PermissionService();
    const mcp = service.checkPermission(
      { input: {}, riskLevel: "medium", toolName: "mcp__fixture__write", mode, planEnabled: true },
      {
        permission: {
          permission: "mcp",
          reason: "fixture",
          riskLevel: "medium",
          sideEffectScope: "network",
          needsApproval: true,
          patternSources: [],
          denyPriority: "beforeAsk",
        },
        readOnly: false,
        destructive: false,
        needsApproval: true,
        sideEffectScope: "network",
      },
      { version: 1, allow: [{ toolName: "mcp" }] },
    );
    assert.equal(mcp.decision, "ask");
    assert.equal(mcp.approvalMode, "user-once");
    const grant = {
      type: "addRules" as const,
      behavior: "allow" as const,
      rules: [{ toolName: "mcp" }],
    };
    const allowed = restrictApprovalGrants(
      { decision: "allow", permissionUpdates: [grant], sessionPermissionUpdates: [grant] },
      mcp.approvalMode,
    );
    assert.equal(allowed.permissionUpdates, undefined);
    assert.equal(allowed.sessionPermissionUpdates, undefined);
    assert.equal(
      service.checkPermission(
        {
          input: { url: "https://fixture.invalid" },
          riskLevel: "medium",
          toolName: "WebFetch",
          mode,
          planEnabled: true,
        },
        { readOnly: true, needsApproval: true, sideEffectScope: "network" },
      ).decision,
      "ask",
    );
    assert.equal(
      service.checkPermission(
        { input: {}, riskLevel: "low", toolName: "Read", mode, planEnabled: true },
        { readOnly: true, needsApproval: false, destructive: false },
      ).decision,
      "allow",
    );
  });
}

test("Guarded plus Plan retains single-use approval after the MCP gate", () => {
  const service = new PermissionService();
  const context = {
    input: {},
    riskLevel: "medium" as const,
    toolName: "mcp__fixture__write",
    mode: "guarded" as const,
    planEnabled: true,
  };
  const capability = {
    permission: {
      permission: "mcp",
      reason: "fixture",
      riskLevel: "medium",
      sideEffectScope: "network",
      needsApproval: true,
      patternSources: [],
      denyPriority: "beforeAsk",
    },
    destructive: false,
    userApprovalRule: "dangerous.fixture",
  };
  const decision = service.checkPermission(context, capability);
  assert.equal(decision.decision, "ask");
  assert.equal(decision.approvalMode, "user-once");
  assert.equal(
    service.checkPermission(context, { ...capability, destructive: true }).decision,
    "deny",
  );
});

for (const scenario of ["build", "plan", "disallowed"] as const) {
  test(`a real Explore child respects its parent's ${scenario} restrictions`, async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-child-permission-"));
    const requests: PermissionBrokerRequest[] = [];
    const executed: unknown[] = [];
    let childCalls = 0;
    let parentCalls = 0;
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const generateText = async (): Promise<ModelResult> => {
      const child = getCurrentModelInvocationContext()?.metadata?.querySource === "subagent";
      if (child && ++childCalls === 1)
        return {
          finishReason: "tool-calls",
          text: "",
          usage,
          toolCalls: [{ id: "child-write", name: "Bash", input: { command: "rm -rf fixture" } }],
        } as ModelResult;
      if (!child && ++parentCalls === 1)
        return {
          finishReason: "tool-calls",
          text: "",
          usage,
          toolCalls: [
            {
              id: "parent-agent",
              name: "Agent",
              input: {
                description: "inspect fixture",
                prompt: "inspect",
                subagent_type: "Explore",
              },
            },
          ],
        } as ModelResult;
      return { finishReason: "stop", text: "done", usage };
    };
    const model: Model = {
      providerId: "fixture" as never,
      modelId: "fixture" as never,
      properties: {
        contextWindow: 200_000,
        supportsToolCall: true,
        supportsMidConversationSystem: true,
        inputFormat: {
          supportsText: true,
          supportsImage: false,
          supportsVideo: false,
          supportsAudio: false,
          supportsPdf: false,
        },
        outputFormat: { supportsText: true },
      },
      optionSpecs: { maxOutputTokens: { max: 32000 } },
      options: { maxOutputTokens: 32000 },
      bind() {
        return this;
      },
      generateText,
      streamText() {
        throw new Error("unexpected stream");
      },
    };
    const runtime = new AgentRuntime(
      createSessionId(`permission-${scenario}`),
      {
        modelSelection: { providerId: "fixture", modelId: "fixture" },
        mode: "build",
        planEnabled: scenario === "plan",
        workingDirectory: root,
        bashShellSelection: {
          dialect: "posix",
          source: "auto-detected",
          display: { name: "bash" },
        },
        subagents: { outputRootDir: join(root, "child-output") },
      },
      {
        eventStore: new InMemorySessionEventStore({ retention: "unbounded" }),
        modelFactory: () => model,
        permissionService: new PermissionService({
          ...defaultPermissionConfig,
          disallowedTools: new Set(scenario === "disallowed" ? ["Bash"] : []),
        }),
        permissionBroker: {
          async requestPermission(request) {
            requests.push(request);
            return { decision: "deny", reason: "fixture denied" };
          },
        },
        executionPort: {
          async run(request) {
            executed.push(request);
            const now = new Date();
            return {
              status: "completed",
              exitCode: 0,
              stdout: { text: "ok", bytes: 2, truncated: false },
              stderr: { text: "", bytes: 0, truncated: false },
              durationMs: 1,
              timedOut: false,
              cancelled: false,
              startedAt: now,
              completedAt: now,
            };
          },
        } as never,
      },
    );
    try {
      await runtime.executeTurn("inspect fixture");
      assert.ok(childCalls > 0, "must run a real child model");
      assert.deepEqual(executed, []);
      assert.equal(requests.length, scenario === "build" ? 1 : 0);
      if (scenario === "build") {
        assert.equal(requests[0]?.mode, "build");
        assert.equal(requests[0]?.origin?.kind, "subagent");
        assert.equal(requests[0]?.sessionId, createSessionId("permission-build"));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
