import { saveSquadFixture } from "./agentSquadFixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uuidv7, type NativeMcpServerRecord, type DelegationTask } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp } from "../src/delegation/delegationMcp.js";

async function rpc(
  record: NativeMcpServerRecord,
  method: string,
  params?: unknown,
  expectedStatus = 200,
) {
  const env = record.config.env!;
  const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, expectedStatus);
  const body = (await response.json()) as any;
  return body.result ?? body;
}
async function call(record: NativeMcpServerRecord, name: string, args = {}) {
  const result = await rpc(record, "tools/call", { name, arguments: args });
  const value = JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(value.error);
  return value;
}

test("squad MCP routes API/ACP leaders to the frozen roster and restricts member tools", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-squad-mcp-"));
  const runs: DelegationTask[] = [];
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "codex", enabled: true, ready: true }],
    apiTargets: async () => [
      {
        kind: "api",
        providerName: "Fixture",
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
      },
    ],
    execute: async (task, context) => {
      await context.update({
        session: { kind: task.execution.kind, id: task.id },
        status: "running",
      });
      runs.push(task);
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return {
        conclusion: "canceled",
        changedFiles: [],
        tests: [],
        risks: [],
        blockers: [],
        structured: true,
      };
    },
    deliver: async () => false,
  });
  let resolutions = 0;
  const bridge = createDelegationMcp(directory, service, {
    resolveAcpExecution: async (_parent, execution) => {
      resolutions++;
      return {
        ...execution,
        config: [...execution.config, { configId: "model", value: "host-model" }],
      };
    },
  });
  try {
    const targets = await service.targets();
    const worker = {
      id: uuidv7(),
      name: "审查员",
      role: "核对",
      execution: { kind: "acp" as const, agent: "codex" as const, config: [] },
    };
    for (const kind of ["acp", "api"] as const) {
      const parent = { workspacePath: directory, kind, sessionId: `parent-${kind}` };
      const leaderExecution =
        kind === "api"
          ? targets.find((target) => target.kind === "api")!.execution
          : worker.execution;
      const squad = await saveSquadFixture(service, {
        id: uuidv7(),
        expectedRevision: 0,
        name: "小队",
        description: "",
        instructions: "最小上下文",
        leader: { ...worker, id: uuidv7(), name: "队长", execution: leaderExecution },
        members: [worker],
      });
      const root = (await bridge.register(parent))!;
      const listing = await call(root.record, "ListDelegationAgents");
      assert.ok(
        listing.some(
          (target: any) => target.squadId === squad.id && target.reference === `squad.${squad.id}`,
        ),
      );
      await assert.rejects(
        call(root.record, "DelegateTask", {
          title: "非法",
          task: "检查",
          squadId: squad.id,
          execution: worker.execution,
        }),
        /exactly one/,
      );
      const leader = await call(root.record, "DelegateTask", {
        title: "分析",
        task: "明确任务",
        background: "必要背景",
        squadId: squad.id,
        intent: "analysis",
      });
      await service.tick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(runs.at(-1)!.id, leader.id);
      const leaderParent = { ...parent, sessionId: leader.id };
      const registration = (await bridge.register(leaderParent))!;
      const members = await call(registration.record, "ListDelegationAgents");
      await assert.rejects(
        call(registration.record, "DelegateTask", {
          title: "绕过成员目录",
          task: "检查",
          profileId: squad.members[0]!.agentId,
        }),
        /squad-member-invalid/,
      );
      assert.deepEqual(members, [
        {
          squadMemberId: worker.id,
          name: worker.name,
          role: worker.role,
          execution: worker.execution,
        },
      ]);
      const memberTask = await call(registration.record, "DelegateTask", {
        title: "成员分析",
        task: "明确子任务",
        intent: "analysis",
        ...members[0],
        name: undefined,
        role: undefined,
      });
      assert.equal(memberTask.squad.memberId, worker.id);
      assert.equal(resolutions, 0, "saved squad roles never inherit the leader model");
      await service.tick();
      await new Promise((resolve) => setImmediate(resolve));
      const memberRegistration = (await bridge.register({
        ...parent,
        kind: "acp",
        sessionId: memberTask.id,
      }))!;
      const tools = await rpc(memberRegistration.record, "tools/list");
      assert.deepEqual(
        tools.tools.map((tool: any) => tool.name),
        ["SubmitDelegationResult"],
      );
      const denied = await rpc(
        memberRegistration.record,
        "tools/call",
        {
          name: "DelegateTask",
          arguments: { title: "非法", task: "越界", execution: worker.execution },
        },
        400,
      );
      assert.match(denied.error.message, /Unknown tool|unknown|not found/i);
      await service.cancel({ ...parent, id: leader.id });
    }
  } finally {
    bridge.dispose();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const parentKind of ["api", "acp"] as const)
  test(`${parentKind} MCP resolves saved profile references without inheriting or replacing the main model`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-profile-mcp-"));
    const service = new AgentDelegationService({
      path: join(directory, "tasks.sqlite"),
      targets: async () => [{ agent: "codex", enabled: true, ready: true }],
      execute: async () => {
        throw new Error("catalog access must not execute a model");
      },
      deliver: async () => false,
    });
    let resolutions = 0;
    const bridge = createDelegationMcp(directory, service, {
      resolveAcpExecution: async (_parent, execution) => {
        resolutions++;
        return execution;
      },
    });
    try {
      const profile = await service.saveAgentProfile({
        id: uuidv7(),
        expectedRevision: 0,
        name: "审查员",
        description: "可复用",
        instructions: "核对源码和测试",
        execution: {
          kind: "acp",
          agent: "codex",
          config: [{ configId: "model", value: "saved-model" }],
        },
      });
      const parent = { workspacePath: directory, kind: parentKind, sessionId: "parent" };
      const registration = (await bridge.register(parent))!;
      const catalog = await call(registration.record, "ListDelegationAgents");
      assert.ok(
        catalog.some(
          (target: any) =>
            target.kind === "profile" &&
            target.profileId === profile.id &&
            target.reference === `agent.${profile.id}`,
        ),
      );
      const input = {
        requestId: uuidv7(),
        title: "核对",
        task: "只检查指定文件",
        intent: "analysis",
        profileId: profile.id,
      };
      for (const extra of [
        { execution: profile.execution },
        { squadId: uuidv7() },
        { squadMemberId: uuidv7() },
      ]) {
        await assert.rejects(
          call(registration.record, "DelegateTask", { ...input, ...extra }),
          /exactly one/,
        );
      }
      const task = await call(registration.record, "DelegateTask", input);
      assert.deepEqual(task.execution, profile.execution);
      assert.equal(task.agentProfile.instructions, profile.instructions);
      assert.equal(resolutions, 0);
      assert.deepEqual(task.parent, parent);
      await service.deleteAgentProfile({ id: profile.id, expectedRevision: 1 });
      assert.equal((await call(registration.record, "DelegateTask", input)).id, task.id);
      await assert.rejects(
        call(registration.record, "DelegateTask", { ...input, requestId: uuidv7() }),
        /profile-not-found/,
      );
    } finally {
      bridge.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    }
  });
