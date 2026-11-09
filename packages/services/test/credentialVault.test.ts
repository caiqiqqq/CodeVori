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
  assert.ok(service.saveVaultEntry);
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
    list: service.listVaultEntries,
    save: service.saveVaultEntry,
    remove: service.deleteVaultEntry,
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
    workspaceIdentity: "workspace:test:qa",
    secret: firstSecret,
  });

  assert.equal(created.hasSecret, true);
  assert.equal("secret" in created, false);
  assert.equal("secretKey" in created, false);
  assert.deepEqual(await fixture.list(), [created]);

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

  const listed = await fixture.list();
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
  assert.equal(secretKeyFor(created.id), originalSecretKey);
  assert.equal(await fixture.service.load(originalSecretKey), firstSecret);

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

  await fixture.remove(created.id);
  assert.deepEqual(await fixture.list(), []);
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
    workspaceIdentity: null,
    secret: "private-key-passphrase",
  });

  await fixture.repository.beginDelete(created.id, process.pid, -1);
  assert.deepEqual(await fixture.list(), []);
  const existing = await fixture.repository.find(created.id);
  assert.equal(existing, null);
});
