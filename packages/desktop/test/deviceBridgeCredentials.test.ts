import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDeviceBridgeCredentialStore,
  createDeviceBridgeCredentials,
  type DeviceBridgeCredentialStore,
} from "../src/main/deviceBridgeCredentials.js";

const account = {
  backendState: "Running",
  nodeId: "self",
  loginName: "account@test.invalid",
  tailnet: "test-network",
};
test("management credential is encrypted, restored only for its account, and explicitly cleared", async () => {
  const directory = await mkdtemp(join(tmpdir(), "device-key-"));
  const secret = randomBytes(32);
  let available = true;
  const cipher = {
    isEncryptionAvailable: () => available,
    encryptString(text: string) {
      const iv = randomBytes(12),
        encryptor = createCipheriv("aes-256-gcm", secret, iv);
      const body = Buffer.concat([encryptor.update(text), encryptor.final()]);
      return Buffer.concat([iv, encryptor.getAuthTag(), body]);
    },
    decryptString(bytes: Buffer) {
      const decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString();
    },
  };
  const file = join(directory, "management-key.enc");
  try {
    const store = () => createDeviceBridgeCredentialStore(directory, cipher);
    const owner = createDeviceBridgeCredentials(store());
    await assert.rejects(owner.save("synthetic-key"), /management_account_required/);
    await owner.activate(account);
    await owner.save("synthetic-key");
    const bytes = await readFile(file);
    assert.equal(bytes.includes("synthetic-key"), false);
    assert.equal(bytes.includes(account.loginName), false);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    owner.invalidate(); // app exit releases memory but preserves the encrypted record
    assert.equal(owner.status().managementConfigured, false);
    const restored = createDeviceBridgeCredentials(store());
    await restored.activate(account);
    assert.equal(restored.key(), "synthetic-key");
    for (const patch of [
      { nodeId: "other" },
      { loginName: "other@test.invalid" },
      { tailnet: "other" },
    ]) {
      await restored.activate({ ...account, ...patch });
      assert.equal(restored.status().managementConfigured, false);
    }
    await restored.activate(account);
    assert.equal(restored.status().managementConfigured, true);
    available = false;
    await assert.rejects(restored.save("replacement"), /management_storage_unavailable/);
    assert.equal(restored.key(), "synthetic-key");
    const unavailable = createDeviceBridgeCredentials(store());
    await unavailable.activate(account);
    assert.equal(unavailable.status().managementStorageError, true);
    assert.equal(unavailable.key(), "");
    await unavailable.clear(); // deletion never requires an available decryptor
    await assert.rejects(readFile(file), { code: "ENOENT" });
    available = true;
    await owner.activate({ ...account, nodeId: "new-self" });
    await owner.save("synthetic-key");
    await writeFile(file, "damaged-ciphertext");
    const corrupt = createDeviceBridgeCredentials(store());
    await corrupt.activate({ ...account, nodeId: "new-self" });
    assert.deepEqual(corrupt.status(), {
      managementConfigured: false,
      managementStorageError: true,
    });
    await corrupt.save("replacement");
    assert.equal(corrupt.status().managementStorageError, undefined);
    await corrupt.clear();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential invalidation rejects late restore/save results and cannot revive a cleared key", async () => {
  let release!: (value?: string) => void;
  let record = "stored";
  const store: DeviceBridgeCredentialStore = {
    read: () =>
      new Promise<string | undefined>((resolve) => {
        release = resolve;
      }),
    save: async (_scope, key) => {
      record = key;
      await new Promise<void>((resolve) => {
        release = () => resolve();
      });
    },
    clear: async () => {
      record = "";
    },
  };
  const owner = createDeviceBridgeCredentials(store);
  const reading = owner.activate(account);
  owner.invalidate();
  release("old-key");
  await reading;
  assert.equal(owner.key(), "");
  await owner.activate(account);
  assert.equal(owner.key(), "");
  const reload = owner.activate({ ...account, nodeId: "other-self" });
  release("stored");
  await reload;
  const saving = owner.save("replacement");
  owner.invalidate();
  release();
  await saving;
  await owner.clear();
  assert.equal(record, "");
  assert.equal(owner.key(), "");
  assert.equal(JSON.stringify(owner.status()).includes("stored"), false);
});

test("reconnect reads the final saved key when a stop invalidates a pending save", async () => {
  let record = "old-key";
  let finish!: () => void;
  const owner = createDeviceBridgeCredentials({
    read: async () => record,
    save: async (_scope, value) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      record = value;
    },
    clear: async () => {
      record = "";
    },
  });
  await owner.activate(account);
  const saving = owner.save("new-key");
  owner.cancelPending();
  finish();
  await saving;
  await owner.activate(account);
  assert.equal(owner.key(), "new-key");
});
