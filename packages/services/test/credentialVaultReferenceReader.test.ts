import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
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
    scope: "project",
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
    scope: "project",
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
    scope: "global",
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
    scope: "global",
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
    scope: "global",
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
    "id",
    "kind",
    "name",
    "port",
    "username",
  ]);
  assert.deepEqual(workspaceServer, {
    id: workspaceServer?.id,
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

  const custom = workspaceOne.find(({ name }) => name === "测试服务器")!;
  const shared = workspaceOne.find(({ name }) => name === "Shared server")!;
  const noCancellation = () => {};
  assert.equal(
    (await host.credentialVaultReferenceReader.readSecret("workspace:one", custom, noCancellation))
      .secret,
    "private-custom-type-secret",
  );
  assert.equal(
    (await host.credentialVaultReferenceReader.readSecret("workspace:two", shared, noCancellation))
      .secret,
    "private-password-shared",
  );
  assert.equal(decryptCalls, 2);
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(
      "workspace:two",
      workspaceServer!,
      noCancellation,
    ),
    /unavailable/,
  );
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(
      "workspace:one",
      { ...custom, id: randomUUID() },
      noCancellation,
    ),
    /unavailable/,
  );
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret("workspace:one", custom, () => {
      throw new Error("Stopped");
    }),
    /Stopped/,
  );
  assert.equal(decryptCalls, 2, "cross-workspace, missing and stopped reads never decrypt");

  await host.service.detachGlobalVaultEntry!(custom.id);
  await host.service.attachVaultEntry!(custom.id, "workspace:two");
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret("workspace:one", custom, noCancellation),
    /unavailable/,
  );
  assert.equal(decryptCalls, 2);

  // 回归依据：跨项目候选只供系统设置关联，不能让未关联项目凭引用 ID 解密。
  assert.ok(
    (await host.service.listAttachableVaultEntries!("workspace:two")).some(
      (entry) => entry.id === workspaceServer!.id,
    ),
  );
  await host.service.attachVaultEntry!(workspaceServer!.id, "workspace:two");
  await host.service.attachVaultEntry!(workspaceServer!.id, "workspace:two");
  assert.equal(
    (await host.credentialVaultReferenceReader.listReferences("workspace:two")).filter(
      (entry) => entry.id === workspaceServer!.id,
    ).length,
    1,
  );
  for (const identity of ["workspace:one", "workspace:two"]) {
    assert.equal(
      (
        await host.credentialVaultReferenceReader.readSecret(
          identity,
          workspaceServer!,
          noCancellation,
        )
      ).secret,
      "private-password-one",
    );
  }
  const beforeDeniedReads = decryptCalls;
  assert.equal(
    (await host.listVaultMetadata("workspace:three")).some(
      (entry) => entry.id === workspaceServer!.id,
    ),
    false,
  );
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(
      "workspace:three",
      workspaceServer!,
      noCancellation,
    ),
    /unavailable/,
  );
  await host.service.detachVaultEntry!(workspaceServer!.id, "workspace:one");
  assert.equal(
    (await host.credentialVaultReferenceReader.listReferences("workspace:one")).some(
      (entry) => entry.id === workspaceServer!.id,
    ),
    false,
  );
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(
      "workspace:one",
      workspaceServer!,
      noCancellation,
    ),
    /unavailable/,
  );
  assert.equal(decryptCalls, beforeDeniedReads, "unassociated/revoked reads never decrypt");
  assert.equal(
    (
      await host.credentialVaultReferenceReader.readSecret(
        "workspace:two",
        workspaceServer!,
        noCancellation,
      )
    ).secret,
    "private-password-one",
  );
  await host.service.detachVaultEntry!(workspaceServer!.id, "workspace:two");
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(
      "workspace:two",
      workspaceServer!,
      noCancellation,
    ),
    /unavailable/,
  );
  const remoteOne = buildRemoteWorkspaceIdentity("/projects/shared", {
    kind: "ssh",
    host: "host-one.example.invalid",
    port: 22,
    username: "tester",
  });
  const remoteTwo = buildRemoteWorkspaceIdentity("/projects/shared", {
    kind: "ssh",
    host: "host-two.example.invalid",
    port: 22,
    username: "tester",
  });
  await host.service.attachVaultEntry!(workspaceServer!.id, remoteOne);
  assert.ok(
    (await host.listVaultMetadata(remoteOne)).some((entry) => entry.id === workspaceServer!.id),
  );
  assert.equal(
    (await host.listVaultMetadata(remoteTwo)).some((entry) => entry.id === workspaceServer!.id),
    false,
  );
  const beforeRemoteRead = decryptCalls;
  await assert.rejects(
    host.credentialVaultReferenceReader.readSecret(remoteTwo, workspaceServer!, noCancellation),
    /unavailable/,
  );
  assert.equal(
    decryptCalls,
    beforeRemoteRead,
    "same path on another remote identity never decrypts",
  );
});
