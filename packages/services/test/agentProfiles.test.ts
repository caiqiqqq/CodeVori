import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7, type AgentProfile, type WorkTaskExecution } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";

const execution: WorkTaskExecution = { kind: "acp", agent: "codex", config: [] };
const parent = { workspacePath: "/project", kind: "acp" as const, sessionId: "parent" };
const input = () => ({
  ...parent,
  requestId: uuidv7(),
  title: "核对",
  task: "核对实现",
  background: "",
  constraints: "",
  expectedResult: "证据",
  intent: "analysis" as const,
  dependsOn: [],
});
const profileDraft = () => ({
  id: uuidv7(),
  expectedRevision: 0,
  name: "审查员",
  description: "代码审查",
  instructions: "核对源码和测试，不做修改",
  execution,
});
function squadDraft(leader: AgentProfile, member: AgentProfile) {
  return {
    id: uuidv7(),
    expectedRevision: 0,
    name: "研发小队",
    description: "",
    instructions: "只汇报",
    leader: { id: uuidv7(), agentId: leader.id, role: "协调" },
    members: [{ id: uuidv7(), agentId: member.id, role: "审查" }],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-profiles-"));
  const deps = {
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "codex" as const, enabled: true, ready: true }],
    execute: async () => {
      throw new Error("configuration must not run models");
    },
    deliver: async () => false,
  };
  const service = new AgentDelegationService(deps);
  return {
    service,
    deps,
    directory,
    async dispose() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("agent profiles use revision checks, persist across restart and reject unavailable runtimes", async () => {
  const f = await fixture();
  let next: AgentDelegationService | undefined;
  try {
    const draft = profileDraft();
    const saved = await f.service.saveAgentProfile(draft);
    await assert.rejects(f.service.saveAgentProfile(draft), /profile-conflict/);
    await assert.rejects(
      f.service.saveAgentProfile({
        ...profileDraft(),
        execution: { kind: "acp", agent: "claude", config: [] },
      }),
      /target-unavailable/,
    );
    const edited = await f.service.saveAgentProfile({
      ...draft,
      expectedRevision: 1,
      name: "新名称",
    });
    assert.equal(edited.revision, 2);
    assert.equal(edited.id, saved.id);
    await f.service.disposeAllAndWait();
    next = new AgentDelegationService(f.deps);
    assert.deepEqual(await next.listAgentProfiles(), [edited]);
    await assert.rejects(
      next.deleteAgentProfile({ id: edited.id, expectedRevision: 1 }),
      /profile-conflict/,
    );
    await next.deleteAgentProfile({ id: edited.id, expectedRevision: 2 });
    assert.deepEqual(await next.listAgentProfiles(), []);
  } finally {
    await next?.disposeAllAndWait();
    await f.dispose();
  }
});

test("squads reference reusable profiles and block duplicates, missing profiles and referenced deletion", async () => {
  const f = await fixture();
  try {
    const leader = await f.service.saveAgentProfile(profileDraft());
    const member = await f.service.saveAgentProfile(profileDraft());
    const first = await f.service.saveSquad(squadDraft(leader, member));
    const second = await f.service.saveSquad(squadDraft(leader, member));
    assert.equal(first.members[0]!.agentId, second.members[0]!.agentId);
    await assert.rejects(
      f.service.deleteAgentProfile({ id: member.id, expectedRevision: 1 }),
      /profile-in-use/,
    );
    const duplicate = squadDraft(leader, leader);
    await assert.rejects(f.service.saveSquad(duplicate));
    await assert.rejects(
      f.service.saveSquad({
        ...squadDraft(leader, member),
        leader: { id: uuidv7(), agentId: uuidv7(), role: "队长" },
      }),
      /profile-not-found/,
    );
    await f.service.deleteSquad({ id: first.id, expectedRevision: 1 });
    await f.service.deleteSquad({ id: second.id, expectedRevision: 1 });
    await f.service.deleteAgentProfile({ id: member.id, expectedRevision: 1 });
    assert.equal((await f.service.listAgentProfiles()).length, 1);
  } finally {
    await f.dispose();
  }
});

test("editing profiles updates future squad runs but freezes already accepted profile and squad tasks", async () => {
  const f = await fixture();
  try {
    const leader = await f.service.saveAgentProfile(profileDraft());
    const member = await f.service.saveAgentProfile(profileDraft());
    const squad = await f.service.saveSquad(squadDraft(leader, member));
    const directInput = { ...input(), profileId: member.id };
    const direct = await f.service.delegateProfile(directInput);
    const old = await f.service.delegateSquad({ ...input(), squadId: squad.id });
    await f.service.saveAgentProfile({
      ...profileDraft(),
      id: member.id,
      expectedRevision: 1,
      name: "新角色",
      instructions: "新的职责",
    });
    const current = (await f.service.listSquads())[0]!;
    assert.equal(current.members[0]!.name, "新角色");
    const fresh = await f.service.delegateSquad({ ...input(), squadId: squad.id });
    assert.equal(
      fresh.squad?.role === "leader" && fresh.squad.definition.members[0]!.instructions,
      "新的职责",
    );
    assert.equal(old.squad?.role === "leader" && old.squad.definition.members[0]!.name, "审查员");
    assert.equal(direct.agentProfile?.instructions, member.instructions);
    await f.service.deleteSquad({ id: squad.id, expectedRevision: 1 });
    await f.service.deleteAgentProfile({ id: member.id, expectedRevision: 2 });
    assert.equal((await f.service.delegateProfile(directInput)).id, direct.id);
    assert.equal(
      (await f.service.list(parent)).find((task) => task.id === direct.id)?.agentProfile?.name,
      "审查员",
    );
  } finally {
    await f.dispose();
  }
});

test("legacy squads migrate once to profiles without changing role IDs, config, revisions or task history", async () => {
  const f = await fixture();
  let next: AgentDelegationService | undefined;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const db = new DatabaseSync(f.deps.path);
    db.exec("CREATE TABLE delegation_squads(id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    const role = () => ({ id: uuidv7(), name: "角色", role: "职责", execution });
    const legacy = {
      id: uuidv7(),
      name: "旧小队",
      description: "",
      instructions: "旧指令",
      leader: role(),
      members: [role()],
      revision: 3,
      createdAt: 10,
      updatedAt: 20,
    };
    db.prepare("INSERT INTO delegation_squads(id,data) VALUES(?,?)").run(
      legacy.id,
      JSON.stringify(legacy),
    );
    db.close();
    const migrated = (await f.service.listSquads())[0]!;
    assert.equal(migrated.leader.id, legacy.leader.id);
    assert.equal(migrated.members[0]!.id, legacy.members[0]!.id);
    assert.equal(migrated.revision, 3);
    assert.deepEqual(migrated.members[0]!.execution, execution);
    assert.equal((await f.service.listAgentProfiles()).length, 2);
    await f.service.disposeAllAndWait();
    next = new AgentDelegationService(f.deps);
    assert.deepEqual(await next.listSquads(), [migrated]);
    assert.equal((await next.listAgentProfiles()).length, 2);
    assert.deepEqual(await next.list(parent), []);
  } finally {
    await next?.disposeAllAndWait();
    await f.dispose();
  }
});

test("remote profile requests never fall back to local execution", async () => {
  const f = await fixture();
  try {
    const profile = await f.service.saveAgentProfile(profileDraft());
    await assert.rejects(
      f.service.delegateProfile({
        ...input(),
        profileId: profile.id,
        workspaceIdentity: "remote:example",
      }),
      /remote-unsupported/,
    );
    assert.deepEqual(await f.service.list(parent), []);
  } finally {
    await f.dispose();
  }
});

test("a profile changed during asynchronous squad validation cannot be saved through a stale check", async () => {
  const f = await fixture();
  try {
    const leader = await f.service.saveAgentProfile(profileDraft());
    const member = await f.service.saveAgentProfile(profileDraft());
    const original = f.deps.targets;
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.deps.targets = async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original();
    };
    const pending = f.service.saveSquad(squadDraft(leader, member));
    await reached;
    f.deps.targets = original;
    await f.service.saveAgentProfile({ ...profileDraft(), id: member.id, expectedRevision: 1 });
    release();
    await assert.rejects(pending, /profile-conflict/);
    assert.deepEqual(await f.service.listSquads(), []);
  } finally {
    await f.dispose();
  }
});
