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
    save: service.saveVaultEntry,
    attach: service.attachVaultEntry,
    detach: service.detachVaultEntry,
    remove: (id: string, workspaceIdentity: string | null = "workspace:test:qa") =>
      service.deleteVaultEntry!(id, workspaceIdentity),
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
  await assert.rejects(fixture.attach(created.id, "workspace:other"), /already attached/);
  assert.deepEqual(await fixture.listUnassigned(), []);
  assert.deepEqual(await fixture.list("workspace:test:qa"), [
    { ...rotatedUnassigned, workspaceIdentity: "workspace:test:qa" },
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
      workspaceIdentity: "workspace:other",
    }),
    /not found in this project/,
  );
  await assert.rejects(fixture.remove(created.id, "workspace:other"), /not found in this project/);
  assert.deepEqual(await fixture.list("workspace:test:qa"), [updated]);
  await assert.rejects(fixture.detach(created.id, "workspace:other"), /not found in this project/);
  await fixture.detach(created.id, "workspace:test:qa");
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  assert.deepEqual(await fixture.listUnassigned(), [{ ...updated, workspaceIdentity: null }]);
  await fixture.attach(created.id, "workspace:other");
  assert.deepEqual(await fixture.list("workspace:other"), [
    { ...updated, workspaceIdentity: "workspace:other" },
  ]);
  await fixture.remove(created.id, "workspace:other");
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
    workspaceIdentity: "workspace:test:qa",
    secret: "private-key-passphrase",
  });

  await fixture.repository.beginDelete(created.id, "workspace:test:qa", process.pid, -1);
  assert.deepEqual(await fixture.list("workspace:test:qa"), []);
  const existing = await fixture.repository.find(created.id);
  assert.equal(existing, null);
});
