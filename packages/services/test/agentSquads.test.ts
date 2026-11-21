import { saveSquadFixture } from "./agentSquadFixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, type DelegationTask } from "@zcode/shared";
import type { DelegationDependencies } from "../src/delegation/contract.js";
import { squadPrompt } from "../src/delegation/squadPrompt.js";
import { DelegationRepository } from "../src/delegation/delegationRepository.js";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";

const parent = { workspacePath: "/project", kind: "acp" as const, sessionId: "parent" };
const member = (name: string) => ({
  id: uuidv7(),
  name,
  role: `${name}职责`,
  execution: { kind: "acp" as const, agent: "codex" as const, config: [] },
});
const definition = () => ({
  id: uuidv7(),
  expectedRevision: 0,
  name: "研发小队",
  description: "独立审查",
  instructions: "仅汇报，不能提交",
  leader: member("队长"),
  members: [member("审查员")],
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-squads-"));
  const runs: Array<{ task: DelegationTask; finish(error?: Error): void; signal: AbortSignal }> =
    [];
  const path = join(directory, "delegations.sqlite");
  const deps: DelegationDependencies = {
    path,
    targets: async () => [
      { agent: "codex", ready: true, enabled: true },
      { agent: "claude", ready: true, enabled: true },
    ],
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
        reasoningLevels: ["low", "high"],
      },
    ],
    execute: async (task, context) => {
      await context.update({
        session: { kind: task.execution.kind, id: `session-${task.id}` },
        status: "running",
      });
      await new Promise<void>((resolve, reject) => {
        runs.push({
          task,
          finish: (error) => (error ? reject(error) : resolve()),
          signal: context.signal,
        });
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        conclusion: "仅汇报",
        changedFiles: [],
        tests: [],
        risks: [],
        blockers: [],
        structured: true,
      };
    },
    deliver: async () => false,
  };
  const service = new AgentDelegationService(deps);
  return {
    service,
    deps,
    runs,
    path,
    async flush() {
      await service.tick();
      await new Promise((resolve) => setImmediate(resolve));
    },
    async dispose() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const taskInput = () => ({
  ...parent,
  requestId: uuidv7(),
  title: "核对功能",
  task: "只分析当前模块",
  background: "必要背景",
  constraints: "不要修改",
  expectedResult: "证据",
  intent: "analysis" as const,
  dependsOn: [],
});

test("squad configuration uses revisions and accepted tasks retain an immutable snapshot", async () => {
  const f = await fixture();
  try {
    const draft = definition();
    const squad = await saveSquadFixture(f.service, draft);
    assert.equal(squad.revision, 1);
    await assert.rejects(
      saveSquadFixture(f.service, { ...draft, name: "陈旧写入" }),
      /squad-conflict/,
    );
    const input = { ...taskInput(), squadId: squad.id };
    const leader = await f.service.delegateSquad(input);
    assert.equal(leader.parent.sessionId, "parent");
    assert.equal(leader.squad?.role, "leader");
    assert.equal(leader.intent, "analysis");
    assert.equal((await f.service.list(parent)).length, 1);
    const edited = await saveSquadFixture(f.service, {
      ...draft,
      expectedRevision: 1,
      name: "新名称",
    });
    await f.service.deleteSquad({ id: edited.id, expectedRevision: edited.revision });
    assert.deepEqual(await f.service.listSquads(), []);
    assert.equal((await f.service.delegateSquad(input)).id, leader.id);
    const saved = (await f.service.list(parent))[0]!;
    assert.equal(saved.squad?.role === "leader" && saved.squad.definition.name, "研发小队");
  } finally {
    await f.dispose();
  }
});

test("a squad reserves worker capacity without enabling unrestricted nested delegation", async () => {
  const f = await fixture();
  try {
    await f.service.updateSettings({
      ...parent,
      enabled: true,
      concurrency: 1,
      allowNested: false,
      maxDepth: 1,
      completedCacheMaxMb: 0,
    });
    const squad = await saveSquadFixture(f.service, definition());
    const leader = await f.service.delegateSquad({ ...taskInput(), squadId: squad.id });
    await f.flush();
    assert.equal(f.runs.length, 1);
    const leaderParent = { ...parent, sessionId: `session-${leader.id}` };
    const input = {
      ...taskInput(),
      ...leaderParent,
      squadMemberId: squad.members[0]!.id,
      execution: squad.members[0]!.execution,
    };
    await assert.rejects(f.service.delegate({ ...input, squadMemberId: uuidv7() }), /squad-member/);
    await assert.rejects(
      f.service.delegate({ ...input, execution: { kind: "acp", agent: "claude", config: [] } }),
      /squad-member/,
    );
    await assert.rejects(f.service.delegate({ ...input, intent: "edit" }), /squad-analysis/);
    const child = await f.service.delegate(input);
    await f.flush();
    assert.equal(f.runs.length, 2);
    assert.equal(child.depth, 2);
    assert.match(child.constraints, /审查员职责/);
    await assert.rejects(
      f.service.delegate({ ...input, sessionId: `session-${child.id}`, requestId: uuidv7() }),
      /nesting-disabled/,
    );
    await assert.rejects(
      f.service.submitResult(leader.id, f.runs[0]!.task.attempts[0]!.commandId, {
        conclusion: "过早完成",
      }),
      /squad-members-pending/,
    );
    await f.service.cancel({ ...parent, id: leader.id });
    assert.equal((await f.service.list(leaderParent))[0]!.status, "canceled");
    assert.equal(f.runs[1]!.signal.aborted, true);
  } finally {
    await f.dispose();
  }
});

test("a leader that exits before its members fails and cancels descendants", async () => {
  const f = await fixture();
  try {
    const squad = await saveSquadFixture(f.service, definition());
    const leader = await f.service.delegateSquad({ ...taskInput(), squadId: squad.id });
    await f.flush();
    const leaderParent = { ...parent, sessionId: `session-${leader.id}` };
    await f.service.delegate({
      ...taskInput(),
      ...leaderParent,
      squadMemberId: squad.members[0]!.id,
      execution: squad.members[0]!.execution,
    });
    await f.flush();
    f.runs[0]!.finish();
    await f.flush();
    const task = (await f.service.list(parent))[0]!;
    assert.equal(task.status, "failed");
    assert.match(task.attempts[0]!.error!, /squad-members-pending/);
    assert.equal((await f.service.list(leaderParent))[0]!.status, "canceled");
  } finally {
    await f.dispose();
  }
});

test("remote squad requests are rejected before any task is accepted", async () => {
  const f = await fixture();
  try {
    const squad = await saveSquadFixture(f.service, definition());
    await assert.rejects(
      f.service.delegateSquad({
        ...taskInput(),
        squadId: squad.id,
        workspaceIdentity: "remote:example",
      }),
      /remote-unsupported/,
    );
    assert.deepEqual(await f.service.list(parent), []);
  } finally {
    await f.dispose();
  }
});

for (const failed of [false, true])
  test(`leader ${failed ? "failure cancels members" : "waits for members then completes"}`, async () => {
    const f = await fixture();
    try {
      const squad = await saveSquadFixture(f.service, definition());
      const leader = await f.service.delegateSquad({ ...taskInput(), squadId: squad.id });
      await f.flush();
      const leaderParent = { ...parent, sessionId: `session-${leader.id}` };
      await f.service.delegate({
        ...taskInput(),
        ...leaderParent,
        squadMemberId: squad.members[0]!.id,
        execution: squad.members[0]!.execution,
      });
      await f.flush();
      if (!failed) {
        f.runs[1]!.finish();
        await f.flush();
      }
      f.runs[0]!.finish(failed ? new Error("leader connection failed") : undefined);
      await f.flush();
      const task = (await f.service.list(parent))[0]!;
      assert.equal(task.status, failed ? "failed" : "completed");
      assert.equal(
        (await f.service.list(leaderParent))[0]!.status,
        failed ? "canceled" : "completed",
      );
      if (failed) assert.match(task.attempts[0]!.error!, /leader connection failed/);
      else assert.equal(task.attempts[0]!.result?.conclusion, "仅汇报");
    } finally {
      await f.dispose();
    }
  });

test("squad settings and accepted snapshots survive restart without replaying runs", async () => {
  const f = await fixture();
  let next: AgentDelegationService | undefined;
  try {
    const draft = definition();
    const squad = await saveSquadFixture(f.service, draft);
    const input = { ...taskInput(), squadId: squad.id };
    const leader = await f.service.delegateSquad(input);
    await f.flush();
    await f.service.disposeAllAndWait();
    next = new AgentDelegationService(f.deps);
    assert.deepEqual(await next.listSquads(), [squad]);
    await next.tick();
    assert.equal(f.runs.length, 1, "restart must not launch another model run");
    const persisted = (await next.list(parent))[0]!;
    assert.equal(persisted.status, "interrupted");
    assert.deepEqual(persisted.squad, leader.squad);
    await next.deleteSquad({ id: squad.id, expectedRevision: squad.revision });
    assert.equal((await next.delegateSquad(input)).id, leader.id);
  } finally {
    await next?.disposeAllAndWait();
    await f.dispose();
  }
});

test("an expired leader cancels old members while its late return cannot cancel resumed members", async () => {
  const f = await fixture();
  const other = new AgentDelegationService(f.deps);
  const repo = new DelegationRepository(f.path);
  try {
    const squad = await saveSquadFixture(f.service, definition());
    const leader = await f.service.delegateSquad({ ...taskInput(), squadId: squad.id });
    await f.flush();
    const leaderParent = { ...parent, sessionId: `session-${leader.id}` };
    const input = {
      ...taskInput(),
      ...leaderParent,
      squadMemberId: squad.members[0]!.id,
      execution: squad.members[0]!.execution,
    };
    await f.service.delegate(input);
    await f.flush();
    await repo.open();
    repo.transaction(() => {
      const current = repo.get(leader.id)!;
      current.leaseUntil = 0;
      repo.put(current);
    });
    await other.tick();
    assert.equal((await other.list(parent))[0]!.status, "interrupted");
    assert.equal((await other.list(leaderParent))[0]!.status, "canceled");
    await other.resume({ ...parent, id: leader.id });
    await other.tick();
    await new Promise((resolve) => setImmediate(resolve));
    const next = await other.delegate({ ...input, requestId: uuidv7() });
    await other.tick();
    await new Promise((resolve) => setImmediate(resolve));
    f.runs[0]!.finish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(repo.get(next.id)!.status, "running");
    assert.equal(repo.get(leader.id)!.status, "running");
    assert.equal(repo.get(leader.id)!.attempts.length, 2);
    await other.cancel({ ...parent, id: leader.id });
  } finally {
    await other.disposeAllAndWait();
    repo.close();
    await f.dispose();
  }
});

test("same API engine roles retain independent IDs and reasoning settings", async () => {
  const f = await fixture();
  try {
    const target = (await f.service.targets()).find((target) => target.kind === "api")!;
    assert.equal(target.kind, "api");
    if (target.kind !== "api") return;
    const draft = definition();
    draft.members = [
      { ...member("开发者"), execution: target.execution },
      {
        ...member("审查员"),
        execution: {
          ...target.execution,
          modelSelection: {
            ...target.execution.modelSelection,
            options: { reasoningLevel: "low" },
          },
        },
      },
    ];
    const squad = await saveSquadFixture(f.service, draft);
    const leader = await f.service.delegateSquad({ ...taskInput(), squadId: squad.id });
    await f.flush();
    const prompt = squadPrompt(leader);
    assert.match(prompt, /squadMemberId/);
    assert.match(prompt, /WaitDelegationTask/);
    assert.match(prompt, /不复制整个历史/);
    assert.match(prompt, /只汇总，不追加返工/);
    const input = { ...taskInput(), sessionId: `session-${leader.id}` };
    await assert.rejects(
      f.service.delegate({
        ...input,
        squadMemberId: squad.members[1]!.id,
        execution: squad.members[0]!.execution,
      }),
      /squad-member-invalid/,
    );
    for (const role of squad.members) {
      const task = await f.service.delegate({
        ...input,
        requestId: uuidv7(),
        squadMemberId: role.id,
        execution: role.execution,
      });
      assert.deepEqual(task.execution, role.execution);
      assert.equal(task.squad?.role === "member" && task.squad.memberId, role.id);
    }
  } finally {
    await f.dispose();
  }
});
