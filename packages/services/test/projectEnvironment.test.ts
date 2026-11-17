import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CredentialVaultEntry } from "../src/credential/credential.js";
import { projectEnvironmentEndpoint } from "../src/credential/projectEnvironmentMcp.js";
import { createProjectEnvironmentService } from "../src/credential/projectEnvironmentService.js";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "codevori-environments-"));
  const entries: CredentialVaultEntry[] = [
    {
      id: randomUUID(),
      name: "Test server",
      kind: "server",
      environment: "test",
      host: "app.example.invalid",
      port: 22,
      username: "observer",
      workspaceIdentity: null,
      hasSecret: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  let busy = false;
  const options = {
    databasePath: join(directory, "credential-vault.sqlite"),
    listCredentials: async () => structuredClone(entries),
    assertSessionIdle: async () => {
      if (busy) throw new Error("environment.session-busy");
    },
  };
  const service = createProjectEnvironmentService(options);
  t.after(async () => {
    service.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const projectScope = {
    workspacePath: "/project",
    workspaceIdentity: "remote:one",
  };
  const scope = {
    ...projectScope,
    kind: "api" as const,
    sessionId: "session-one",
  };
  const input = {
    ...projectScope,
    name: "Test",
    environment: "test" as const,
    instructions: "Read the application logs",
    resources: [
      { credentialId: entries[0]!.id, purpose: "Application server", instructions: "Service: app" },
    ],
    expectedRevision: 0,
  };
  return {
    service,
    options,
    entries,
    projectScope,
    scope,
    input,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

test("environment profiles persist and reject stale edits/deletes", async (t) => {
  const { service, options, input } = await fixture(t);
  const saved = await service.saveProjectEnvironment(input);
  assert.equal(saved.revision, 1);
  const changed = await service.saveProjectEnvironment({
    ...input,
    id: saved.id,
    expectedRevision: 1,
    name: "QA",
  });
  assert.equal(changed.revision, 2);
  await assert.rejects(
    service.saveProjectEnvironment({ ...input, id: saved.id, expectedRevision: 1 }),
    /conflict/,
  );
  await assert.rejects(
    service.deleteProjectEnvironment({
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
      id: saved.id,
      expectedRevision: 1,
    }),
    /conflict/,
  );
  const reopened = createProjectEnvironmentService(options);
  try {
    assert.equal(
      (
        await reopened.listProjectEnvironments({
          workspacePath: input.workspacePath,
          workspaceIdentity: input.workspaceIdentity,
        })
      )[0]?.name,
      "QA",
    );
  } finally {
    reopened.dispose();
  }
  await service.deleteProjectEnvironment({
    workspacePath: input.workspacePath,
    workspaceIdentity: input.workspaceIdentity,
    id: saved.id,
    expectedRevision: 2,
  });
  assert.deepEqual(
    await service.listProjectEnvironments({
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
    }),
    [],
  );
});

test("environment reads and credential bindings enforce exact workspace identity", async (t) => {
  const { service, input, entries, projectScope, scope } = await fixture(t);
  entries[0]!.workspaceIdentity = scope.workspaceIdentity;
  const saved = await service.saveProjectEnvironment(input);
  const other = { ...projectScope, workspaceIdentity: "remote:two" };
  assert.deepEqual(await service.listProjectEnvironments(other), []);
  await assert.rejects(service.readProjectEnvironment({ ...other, id: saved.id }), /unavailable/);
  await assert.rejects(
    service.saveProjectEnvironment({ ...input, workspaceIdentity: "remote:two" }),
    /credential-unavailable/,
  );
  await assert.rejects(
    service.setSessionEnvironment({
      ...scope,
      workspaceIdentity: other.workspaceIdentity,
      environmentId: saved.id,
      expectedRevision: 0,
    }),
    /unavailable/,
  );
  await assert.rejects(
    service.deleteProjectEnvironment({ ...other, id: saved.id, expectedRevision: 1 }),
    /unavailable/,
  );
});

test("environment resources resolve current metadata and retain unavailable references", async (t) => {
  const { service, entries, input, projectScope } = await fixture(t);
  const saved = await service.saveProjectEnvironment(input);
  entries[0]!.host = "updated.example.invalid";
  const read = await service.readProjectEnvironment({ ...projectScope, id: saved.id });
  assert.equal(read.resources[0]?.credential?.host, "updated.example.invalid");
  assert.doesNotMatch(JSON.stringify(read), /secret_key|secretKey|password|token/i);
  entries[0]!.workspaceIdentity = "another-workspace";
  const unavailable = await service.readProjectEnvironment({ ...projectScope, id: saved.id });
  assert.equal(unavailable.resources[0]?.credential, null);
  assert.equal(unavailable.resources[0]?.credentialId, input.resources[0]!.credentialId);
  entries.length = 0;
  assert.equal(
    (await service.readProjectEnvironment({ ...projectScope, id: saved.id })).resources[0]
      ?.credential,
    null,
  );
});

test("session selections are durable, broadcast, isolated, and cannot change while busy", async (t) => {
  const { service, options, input, projectScope, scope, setBusy } = await fixture(t);
  const saved = await service.saveProjectEnvironment(input);
  const changes: unknown[] = [];
  const subscription = service.onDynamicProjectEnvironmentsChanged(projectScope)(() =>
    changes.push(true),
  );
  t.after(() => subscription.dispose());
  const binding = await service.setSessionEnvironment({
    ...scope,
    environmentId: saved.id,
    expectedRevision: 0,
  });
  assert.equal(binding.environmentId, saved.id);
  assert.equal(changes.length, 1);
  assert.equal(
    (await service.getSessionEnvironment({ ...scope, kind: "acp" })).environmentId,
    null,
  );
  assert.equal(
    (await service.getSessionEnvironment({ ...scope, sessionId: "other" })).environmentId,
    null,
  );
  await assert.rejects(
    service.setSessionEnvironment({ ...scope, environmentId: null, expectedRevision: 0 }),
    /conflict/,
  );
  setBusy(true);
  await assert.rejects(
    service.setSessionEnvironment({ ...scope, environmentId: null, expectedRevision: 1 }),
    /busy/,
  );
  assert.equal((await service.getSessionEnvironment(scope)).environmentId, saved.id);
  setBusy(false);
  const reopened = createProjectEnvironmentService(options);
  try {
    assert.equal((await reopened.getSessionEnvironment(scope)).environmentId, saved.id);
  } finally {
    reopened.dispose();
  }
  await service.deleteProjectEnvironment({ ...projectScope, id: saved.id, expectedRevision: 1 });
  const deleted = await service.getSessionEnvironment(scope);
  assert.equal(deleted.environmentId, saved.id);
  assert.equal(deleted.environment, null);
});

test("an input admitted during the idle check prevents an environment switch", async (t) => {
  const { service, input, scope, options } = await fixture(t);
  const saved = await service.saveProjectEnvironment(input);
  let idleCheckStarted!: () => void;
  let releaseIdleCheck!: () => void;
  const started = new Promise<void>((resolve) => {
    idleCheckStarted = resolve;
  });
  const idleGate = new Promise<void>((resolve) => {
    releaseIdleCheck = resolve;
  });
  const guarded = createProjectEnvironmentService({
    ...options,
    assertSessionIdle: async () => {
      idleCheckStarted();
      await idleGate;
    },
  });
  t.after(() => guarded.dispose());

  const switching = guarded.setSessionEnvironment({
    ...scope,
    environmentId: saved.id,
    expectedRevision: 0,
  });
  await started;
  const releaseInput = guarded.beginInput(scope);
  releaseIdleCheck();
  await assert.rejects(switching, /environment.session-busy/);
  releaseInput();
  assert.equal((await guarded.getSessionEnvironment(scope)).environmentId, null);
});

test("environment MCP binds scope at registration and returns metadata without secrets", async (t) => {
  const { service, input, scope } = await fixture(t);
  const saved = await service.saveProjectEnvironment(input);
  const endpoint = projectEnvironmentEndpoint(service, scope);
  const list = await endpoint.call("ListProjectEnvironments", {});
  assert.equal((list as Array<{ id: string }>)[0]?.id, saved.id);
  await assert.rejects(
    endpoint.call("ReadProjectEnvironment", { id: saved.id, workspacePath: "/another-project" }),
    /Unrecognized key/,
  );
  const read = await endpoint.call("ReadProjectEnvironment", { id: saved.id });
  assert.doesNotMatch(JSON.stringify(read), /secret|password|bearer/i);
});
