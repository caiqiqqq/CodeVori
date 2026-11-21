import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCredentialService } from "../src/credential/credentialService.js";
import { CredentialVaultRepository } from "../src/credential/credentialVaultRepository.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const testCipher = {
  encrypt(value: string) {
    return `test-encrypted:${Buffer.from(value).toString("base64")}`;
  },
  decrypt(value: string) {
    if (!value.startsWith("test-encrypted:")) return value;
    return Buffer.from(value.slice("test-encrypted:".length), "base64").toString("utf8");
  },
};

async function createFixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "codevori-credential-vault-"));
  const previousDataBaseDir = getDataBaseDir();
  setDataBaseDir(root);
  const repository = new CredentialVaultRepository(
    join(root, ".codevori", "v2", "credential-vault.sqlite"),
  );
  const service = createCredentialService({
    cipherProvider: testCipher,
    vaultRepository: repository,
  });
  assert.ok(service.listVaultEntries);
  assert.ok(service.listUnassignedVaultEntries);
  assert.ok(service.listAttachableVaultEntries);
  assert.ok(service.listGlobalVaultEntries);
  assert.ok(service.saveVaultEntry);
  assert.ok(service.attachVaultEntry);
  assert.ok(service.detachVaultEntry);
  assert.ok(service.deleteVaultEntry);
  t.after(async () => {
    repository.close();
    setDataBaseDir(previousDataBaseDir);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    repository,
    service,
    list: (workspaceIdentity = "workspace:test:qa") => service.listVaultEntries!(workspaceIdentity),
    listUnassigned: () => service.listUnassignedVaultEntries!(),
    listAttachable: (workspaceIdentity = "workspace:test:qa") =>
      service.listAttachableVaultEntries!(workspaceIdentity),
    listGlobal: () => service.listGlobalVaultEntries!(),
    save: service.saveVaultEntry,
    attach: service.attachVaultEntry,
    attachGlobal: service.attachVaultEntryGlobally,
    detach: service.detachVaultEntry,
    detachGlobal: service.detachGlobalVaultEntry,
    remove: (
      id: string,
      scope: "unassigned" | "global" | "project" = "project",
      workspaceIdentity: string | null = "workspace:test:qa",
    ) => service.deleteVaultEntry!(id, scope, workspaceIdentity),
  };
}

test("credential vault keeps secrets out of SQLite and list results, then rotates and deletes them", async (t) => {
  const fixture = await createFixture(t);
  const firstSecret = "initial-token-7a19";
  const created = await fixture.save({
    name: "QA database",
    kind: "database",
    environment: "test",
    host: "db.qa.example.invalid",
    port: 5432,
    username: "qa_reader",
    scope: "unassigned",
    workspaceIdentity: null,
    secret: firstSecret,
  });

  assert.equal(created.hasSecret, true);
  assert.equal("secret" in created, false);
  assert.equal("secretKey" in created, false);
  assert.equal(created.workspaceIdentity, null);
  assert.deepEqual(await fixture.listUnassigned(), [created]);
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  assert.deepEqual(await fixture.list("workspace:other"), []);

  const databasePath = join(fixture.root, ".codevori", "v2", "credential-vault.sqlite");
  const database = new DatabaseSync(databasePath);
  t.after(() => database.close());
  const secretKeyFor = (id: string) => {
    const row = database
      .prepare("SELECT secret_key FROM credential_vault_entries WHERE id = ?")
      .get(id) as { secret_key: string } | undefined;
    return row?.secret_key ?? null;
  };
  const originalSecretKey = secretKeyFor(created.id);
  assert.ok(originalSecretKey);
  assert.equal(await fixture.service.load(originalSecretKey), firstSecret);

  const unassignedRotation = await fixture.save({
    id: created.id,
    name: created.name,
    kind: created.kind,
    environment: created.environment,
    host: created.host,
    port: created.port,
    username: created.username,
    scope: "unassigned",
    workspaceIdentity: null,
  });
  assert.equal(unassignedRotation.workspaceIdentity, null);
  const rotatedUnassigned = await fixture.save({
    id: created.id,
    name: created.name,
    kind: created.kind,
    environment: created.environment,
    host: created.host,
    port: created.port,
    username: created.username,
    scope: "unassigned",
    workspaceIdentity: null,
    secret: "unassigned-rotated-token",
  });
  assert.equal(rotatedUnassigned.workspaceIdentity, null);
  assert.equal(await fixture.service.load(originalSecretKey), null);
  assert.deepEqual(await fixture.listUnassigned(), [rotatedUnassigned]);
  const unassignedSecretKey = secretKeyFor(created.id);
  assert.ok(unassignedSecretKey);
  assert.equal(await fixture.service.load(unassignedSecretKey), "unassigned-rotated-token");

  await fixture.attach(created.id, "workspace:test:qa");
  await fixture.attach(created.id, "workspace:test:qa");
  await fixture.attach(created.id, "workspace:other");
  assert.deepEqual(await fixture.listUnassigned(), []);
  assert.deepEqual(await fixture.list("workspace:test:qa"), [
    { ...rotatedUnassigned, scope: "project", workspaceIdentity: "workspace:test:qa" },
  ]);
  assert.deepEqual(await fixture.list("workspace:other"), [
    { ...rotatedUnassigned, scope: "project", workspaceIdentity: "workspace:other" },
  ]);
  assert.deepEqual(await fixture.listAttachable("workspace:test:qa"), []);
  assert.deepEqual(await fixture.listAttachable("workspace:new"), [
    { ...rotatedUnassigned, scope: "project", workspaceIdentity: null },
  ]);

  const databaseArtifacts = await Promise.all(
    [databasePath, `${databasePath}-wal`].map((path) =>
      readFile(path).catch(() => Buffer.alloc(0)),
    ),
  );
  assert.equal(Buffer.concat(databaseArtifacts).includes(Buffer.from(firstSecret)), false);
  const credentialsText = await readFile(
    join(fixture.root, ".codevori", "v2", "credentials.json"),
    "utf8",
  );
  assert.equal(credentialsText.includes(firstSecret), false);

  const listed = await fixture.list("workspace:test:qa");
  assert.equal("secretKey" in listed[0]!, false);

  await fixture.save({
    id: created.id,
    name: "QA database updated",
    kind: "database",
    environment: "test",
    host: "db.qa.example.invalid",
    port: 5432,
    username: "qa_reader",
    scope: "project",
    workspaceIdentity: "workspace:test:qa",
  });
  const unchangedKey = await fixture.repository.find(created.id);
  assert.ok(unchangedKey && !("status" in unchangedKey));
  assert.equal(secretKeyFor(created.id), unassignedSecretKey);
  assert.equal(await fixture.service.load(unassignedSecretKey), "unassigned-rotated-token");

  const updated = await fixture.save({
    id: created.id,
    name: "QA database updated",
    kind: "database",
    environment: "test",
    host: "db.qa.example.invalid",
    port: 5432,
    username: "qa_reader",
    scope: "project",
    workspaceIdentity: "workspace:test:qa",
    secret: "rotated-token-9b31",
  });
  assert.equal(updated.name, "QA database updated");
  const rotatedSecretKey = secretKeyFor(created.id);
  assert.ok(rotatedSecretKey);
  assert.notEqual(rotatedSecretKey, originalSecretKey);
  assert.equal(await fixture.service.load(originalSecretKey), null);
  assert.equal(await fixture.service.load(rotatedSecretKey), "rotated-token-9b31");
  const credentialsAfterRotation = await readFile(
    join(fixture.root, ".codevori", "v2", "credentials.json"),
    "utf8",
  );
  assert.equal(credentialsAfterRotation.includes(firstSecret), false);
  assert.equal(credentialsAfterRotation.includes("rotated-token-9b31"), false);

  await assert.rejects(
    fixture.save({
      id: created.id,
      name: "Attempted cross-project edit",
      kind: "database",
      environment: "test",
      host: "other.example.invalid",
      port: null,
      username: null,
      scope: "project",
      workspaceIdentity: "workspace:third",
    }),
    /not found in this scope/,
  );
  await assert.rejects(
    fixture.remove(created.id, "project", "workspace:third"),
    /not found in this scope/,
  );
  assert.deepEqual(await fixture.list("workspace:test:qa"), [updated]);
  assert.deepEqual(await fixture.list("workspace:other"), [
    { ...updated, workspaceIdentity: "workspace:other" },
  ]);
  await fixture.detach(created.id, "workspace:test:qa");
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  assert.deepEqual(await fixture.list("workspace:other"), [
    { ...updated, workspaceIdentity: "workspace:other" },
  ]);
  assert.deepEqual(await fixture.listUnassigned(), []);
  await fixture.detach(created.id, "workspace:other");
  assert.deepEqual(await fixture.listUnassigned(), [
    { ...updated, scope: "unassigned", workspaceIdentity: null },
  ]);
  await fixture.attach(created.id, "workspace:other");
  assert.deepEqual(await fixture.list("workspace:other"), [
    { ...updated, workspaceIdentity: "workspace:other" },
  ]);
  await fixture.remove(created.id, "project", "workspace:other");
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  assert.equal(await fixture.service.load(rotatedSecretKey), null);
});

test("credential vault resumes an interrupted deletion when the Host restarts", async (t) => {
  const fixture = await createFixture(t);
  const created = await fixture.save({
    name: "QA server",
    kind: "server",
    environment: "test",
    host: "qa.example.invalid",
    port: 22,
    username: "deploy",
    scope: "project",
    workspaceIdentity: "workspace:test:qa",
    secret: "private-key-passphrase",
  });

  await fixture.repository.beginDelete(created.id, "project", "workspace:test:qa", process.pid, -1);
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  const existing = await fixture.repository.find(created.id);
  assert.equal(existing, null);
});

test("global credentials stay out of project lists and project credentials can be shared", async (t) => {
  const fixture = await createFixture(t);
  const unassigned = await fixture.save({
    name: "Shared deployment server",
    kind: "server",
    environment: "production",
    host: "deploy.example.invalid",
    port: 22,
    username: "release",
    scope: "unassigned",
    workspaceIdentity: null,
    secret: "shared-secret",
  });

  await fixture.attachGlobal!(unassigned.id);
  const global = { ...unassigned, scope: "global" as const };
  assert.deepEqual(await fixture.listGlobal(), [global]);
  assert.deepEqual(await fixture.list("workspace:one"), []);
  assert.deepEqual(await fixture.list("workspace:two"), []);
  assert.deepEqual(await fixture.listUnassigned(), []);
  assert.deepEqual(await fixture.listAttachable("workspace:one"), []);
  await assert.rejects(
    fixture.save({
      id: global.id,
      name: global.name,
      kind: global.kind,
      environment: global.environment,
      host: global.host,
      port: global.port,
      username: global.username,
      scope: "project",
      workspaceIdentity: "workspace:one",
    }),
    /not found in this scope/,
  );
  await assert.rejects(fixture.remove(unassigned.id, "project", null), /not found in this scope/);

  await fixture.detachGlobal!(unassigned.id);
  assert.deepEqual(await fixture.listGlobal(), []);
  assert.deepEqual(await fixture.listUnassigned(), [{ ...global, scope: "unassigned" as const }]);
  await fixture.attach(unassigned.id, "workspace:one");
  assert.deepEqual(await fixture.list("workspace:one"), [
    { ...unassigned, scope: "project" as const, workspaceIdentity: "workspace:one" },
  ]);
  await fixture.attach(unassigned.id, "workspace:two");
  assert.deepEqual(await fixture.list("workspace:two"), [
    { ...unassigned, scope: "project" as const, workspaceIdentity: "workspace:two" },
  ]);
  await fixture.detach(unassigned.id, "workspace:one");
  assert.deepEqual(await fixture.list("workspace:two"), [
    { ...unassigned, scope: "project" as const, workspaceIdentity: "workspace:two" },
  ]);
  await fixture.detach(unassigned.id, "workspace:two");
  assert.deepEqual(await fixture.listUnassigned(), [
    { ...unassigned, scope: "unassigned" as const, workspaceIdentity: null },
  ]);
});

test("vault migration preserves legacy project attachments and unassigned rows", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codevori-credential-vault-migration-"));
  const databasePath = join(root, "credential-vault.sqlite");
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE credential_vault_entries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('server', 'database')), environment TEXT NOT NULL,
      host TEXT NOT NULL, port INTEGER, username TEXT, workspace_identity TEXT,
      secret_key TEXT NOT NULL, previous_secret_key TEXT,
      status TEXT NOT NULL, operation_owner_pid INTEGER, operation_owner_started_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO credential_vault_entries VALUES
      ('legacy-project', 'Project', 'server', 'test', 'project.example.invalid', 22, NULL,
       'workspace:legacy', 'secret-project', NULL, 'active', NULL, NULL, 1, 1),
      ('legacy-unassigned', 'Unassigned', 'server', 'test', 'free.example.invalid', 22, NULL,
       NULL, 'secret-free', NULL, 'active', NULL, NULL, 2, 2);
  `);
  legacyDatabase.close();
  const repository = new CredentialVaultRepository(databasePath);
  t.after(async () => {
    repository.close();
    await rm(root, { recursive: true, force: true });
  });

  assert.deepEqual(
    (await repository.listActive("workspace:legacy")).map(({ scope, workspaceIdentity }) => ({
      scope,
      workspaceIdentity,
    })),
    [{ scope: "project", workspaceIdentity: "workspace:legacy" }],
  );
  assert.deepEqual(
    (await repository.listUnassigned()).map(({ scope, workspaceIdentity }) => ({
      scope,
      workspaceIdentity,
    })),
    [{ scope: "unassigned", workspaceIdentity: null }],
  );
  await repository.reserveCreate(
    {
      name: "Custom type",
      kind: "vendor-specific",
      environment: "test",
      host: "custom.example.invalid",
      port: null,
      username: null,
      scope: "unassigned",
      workspaceIdentity: null,
      secret: "stored-separately",
    },
    "00000000-0000-4000-8000-000000000001",
    "credential-vault:custom-type",
    process.pid,
    Date.now(),
    Date.now(),
  );
  assert.equal((await repository.find("00000000-0000-4000-8000-000000000001"))?.status, "creating");
});
