import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCredentialServiceWithHostAccess } from "../src/credential/credentialService.js";
import { CredentialVaultRepository } from "../src/credential/credentialVaultRepository.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const testCipher = {
  encrypt(value: string) {
    return `test-encrypted:${Buffer.from(value).toString("base64")}`;
  },
  decrypt(value: string) {
    return Buffer.from(value.slice("test-encrypted:".length), "base64").toString("utf8");
  },
};

test("credentialed SSH uses only the current workspace credential after authorization and redacts output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codevori-credential-ssh-access-"));
  const previousDataBaseDir = getDataBaseDir();
  setDataBaseDir(root);
  const databasePath = join(root, ".codevori", "v2", "credential-vault.sqlite");
  const repository = new CredentialVaultRepository(databasePath);
  const calls: Array<{ host: string; username: string; password: string; command: string }> = [];
  let executorFailure: string | undefined;
  const host = createCredentialServiceWithHostAccess({
    cipherProvider: testCipher,
    vaultRepository: repository,
    sshCommandExecutor: async ({ host, username, password, command }) => {
      calls.push({ host, username, password, command });
      if (executorFailure) throw new Error(`SSH failed: ${executorFailure}`);
      return {
        exitCode: 0,
        stdout: `connected with ${password}`,
        stderr: `diagnostic ${password}`,
      };
    },
  });
  const save = host.service.saveVaultEntry;
  assert.ok(save);
  const scopedServer = await save({
    name: "Workspace server",
    kind: "server",
    environment: "test",
    host: "192.0.2.10",
    port: 22,
    username: "root",
    workspaceIdentity: "workspace:one",
    secret: "private-password-one",
  });
  const otherServer = await save({
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

  const access = host.credentialVaultHostAccess;
  assert.ok(access);
  const listed = await access.listServers("workspace:one");
  assert.deepEqual(
    listed.map(({ id, name, username }) => ({ id, name, username })),
    [{ id: scopedServer.id, name: "Workspace server", username: "root" }],
  );
  assert.doesNotMatch(JSON.stringify(listed), /private-password|secretKey/);

  await save({
    id: scopedServer.id,
    name: "Workspace server",
    kind: "server",
    environment: "test",
    host: "192.0.2.99",
    port: 22,
    username: "root",
    workspaceIdentity: "workspace:one",
  });
  await assert.rejects(
    access.executeCommand(listed[0]!, "workspace:one", "whoami", () => {}),
    /changed after approval/,
  );
  assert.equal(calls.length, 0, "changed server details invalidate the approved target");
  await save({
    id: scopedServer.id,
    name: "Workspace server",
    kind: "server",
    environment: "test",
    host: "192.0.2.10",
    port: 22,
    username: "root",
    workspaceIdentity: "workspace:one",
  });

  await assert.rejects(
    access.executeCommand(
      { ...listed[0]!, id: otherServer.id },
      "workspace:one",
      "whoami",
      () => {},
    ),
    /not found/,
  );
  assert.equal(calls.length, 0);

  let authorizationChecks = 0;
  await assert.rejects(
    access.executeCommand(listed[0]!, "workspace:one", "whoami", () => {
      authorizationChecks += 1;
      if (authorizationChecks === 2) throw new Error("authorization expired");
    }),
    /authorization expired/,
  );
  assert.equal(calls.length, 0, "expired authorization prevents starting SSH");

  const result = await access.executeCommand(listed[0]!, "workspace:one", "whoami", () => {});
  assert.deepEqual(calls.at(-1), {
    host: "192.0.2.10",
    username: "root",
    password: "private-password-one",
    command: "whoami",
  });
  assert.equal(result.stdout, "connected with [redacted]");
  assert.equal(result.stderr, "diagnostic [redacted]");

  executorFailure = "private-password-one";
  await assert.rejects(
    access.executeCommand(listed[0]!, "workspace:one", "whoami", () => {}),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "SSH failed: [redacted]");
      return true;
    },
  );

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
