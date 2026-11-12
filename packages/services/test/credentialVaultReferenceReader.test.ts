import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCredentialServiceWithReferenceReader } from "../src/credential/credentialService.js";
import { CredentialVaultRepository } from "../src/credential/credentialVaultRepository.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

test("credential reference reader returns all workspace metadata without decrypting secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codevori-credential-reference-reader-"));
  const previousDataBaseDir = getDataBaseDir();
  setDataBaseDir(root);
  const databasePath = join(root, ".codevori", "v2", "credential-vault.sqlite");
  const repository = new CredentialVaultRepository(databasePath);
  let decryptCalls = 0;
  const testCipher = {
    encrypt(value: string) {
      return `test-encrypted:${Buffer.from(value).toString("base64")}`;
    },
    decrypt(value: string) {
      decryptCalls += 1;
      return Buffer.from(value.slice("test-encrypted:".length), "base64").toString("utf8");
    },
  };
  const host = createCredentialServiceWithReferenceReader({
    cipherProvider: testCipher,
    vaultRepository: repository,
  });
  const save = host.service.saveVaultEntry;
  assert.ok(save);
  await save({
    name: "Workspace server",
    kind: "server",
    environment: "staging",
    host: "192.0.2.10",
    port: 2222,
    username: "deploy",
    workspaceIdentity: "workspace:one",
    secret: "private-password-one",
  });
  await save({
    name: "Other workspace server",
    kind: "server",
    environment: "test",
    host: "192.0.2.11",
    port: 22,
    username: "root",
    workspaceIdentity: "workspace:two",
    secret: "private-password-two",
  });
  await save({
    name: "Shared server",
    kind: "server",
    environment: "production",
    host: "shared.example.invalid",
    port: null,
    username: "observer",
    workspaceIdentity: null,
    secret: "private-password-shared",
  });
  await save({
    name: "测试服务器",
    kind: "测试服务器",
    environment: "test",
    host: "custom.example.invalid",
    port: 2200,
    username: "tester",
    workspaceIdentity: null,
    secret: "private-custom-type-secret",
  });
  await save({
    name: "Database",
    kind: "database",
    environment: "test",
    host: "db.example.invalid",
    port: 5432,
    username: "reader",
    workspaceIdentity: null,
    secret: "private-database-password",
  });

  t.after(async () => {
    repository.close();
    setDataBaseDir(previousDataBaseDir);
    await rm(root, { recursive: true, force: true });
  });

  const workspaceOne = await host.credentialVaultReferenceReader.listReferences("workspace:one");
  const workspaceTwo = await host.credentialVaultReferenceReader.listReferences("workspace:two");
  assert.deepEqual(
    workspaceOne.map(({ name }) => name).sort(),
    ["Database", "Shared server", "Workspace server", "测试服务器"].sort(),
  );
  assert.deepEqual(
    workspaceTwo.map(({ name }) => name).sort(),
    ["Database", "Other workspace server", "Shared server", "测试服务器"].sort(),
  );
  const workspaceServer = workspaceOne.find(({ name }) => name === "Workspace server");
  assert.deepEqual(Object.keys(workspaceServer ?? {}).sort(), [
    "environment",
    "host",
    "kind",
    "name",
    "port",
    "username",
  ]);
  assert.deepEqual(workspaceServer, {
    name: "Workspace server",
    kind: "server",
    environment: "staging",
    host: "192.0.2.10",
    port: 2222,
    username: "deploy",
  });
  assert.equal(workspaceOne.find(({ name }) => name === "测试服务器")?.kind, "测试服务器");
  assert.equal(decryptCalls, 0);
  assert.doesNotMatch(
    JSON.stringify(workspaceOne),
    /private-password|private-custom-type-secret|secretKey|secret_key/,
  );
  await assert.rejects(host.credentialVaultReferenceReader.listReferences("  "), /too_small/);

  const database = new DatabaseSync(databasePath);
  try {
    const databaseBytes = database
      .prepare("SELECT secret_key FROM credential_vault_entries ORDER BY name")
      .all() as Array<{ secret_key: string }>;
    assert.equal(JSON.stringify(databaseBytes).includes("private-password"), false);
  } finally {
    database.close();
  }
});
