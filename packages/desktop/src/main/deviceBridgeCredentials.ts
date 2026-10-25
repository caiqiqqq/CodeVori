import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";
import type { DeviceBridgeWorkerState } from "@zcode/shared";

export interface DeviceBridgeCredentialStore {
  read(scope: string): Promise<string | undefined>;
  save(scope: string, key: string): Promise<void>;
  clear(): Promise<void>;
}
const storageFailure = () => Error("device_bridge_management_storage_unavailable");
const validKey = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Za-z0-9_-]{1,4096}$/.test(key);

/** Main-only encrypted persistence. Never downgrade to plaintext when OS protection is unavailable. */
export function createDeviceBridgeCredentialStore(
  directory: string,
  cipher: {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
  },
): DeviceBridgeCredentialStore {
  const file = join(directory, "management-key.enc");
  return {
    async read(scope) {
      try {
        let raw: string;
        try {
          raw = await readFile(file, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
        if (
          !cipher.isEncryptionAvailable() ||
          raw.length > 65536 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)
        )
          throw storageFailure();
        const record: unknown = JSON.parse(cipher.decryptString(Buffer.from(raw, "base64")));
        if (
          !record ||
          typeof record !== "object" ||
          !("version" in record) ||
          record.version !== 1 ||
          !("scope" in record) ||
          typeof record.scope !== "string" ||
          record.scope.length > 4096 ||
          !("key" in record) ||
          !validKey(record.key)
        )
          throw storageFailure();
        return record.scope === scope ? record.key : undefined;
      } catch {
        throw storageFailure();
      }
    },
    async save(scope, key) {
      try {
        if (!scope || scope.length > 4096 || !validKey(key) || !cipher.isEncryptionAvailable())
          throw storageFailure();
        const encrypted = cipher.encryptString(JSON.stringify({ version: 1, scope, key }));
        await atomicWritePrivateTextFile(file, encrypted.toString("base64"));
      } catch {
        throw storageFailure();
      }
    },
    async clear() {
      try {
        await rm(file, { force: true });
      } catch {
        throw storageFailure();
      }
    },
  };
}

type Identity = Pick<DeviceBridgeWorkerState, "backendState" | "nodeId" | "loginName" | "tailnet">;
/** Owns the active key and revision; controller admission serializes persistence operations. */
export function createDeviceBridgeCredentials(store?: DeviceBridgeCredentialStore) {
  let key = "",
    scope = "",
    revision = 0,
    loaded = false,
    storageError = false;
  const invalidate = () => {
    revision++;
    key = "";
    // 清除可抢先失效正在读取的密文；同账号刷新不能在排队删除前再次加载旧密钥。
    loaded = true;
  };
  return {
    key: () => key,
    revision: () => revision,
    invalidate,
    cancelPending() {
      revision++;
      // 停止时写盘可能仍在完成；下次连接应重新读取最终记录，不能沿用旧缓存。
      if (store) loaded = false;
    },
    status: () => ({
      managementConfigured: Boolean(key),
      ...(storageError ? { managementStorageError: true as const } : {}),
    }),
    async activate(identity: Identity) {
      const next =
        identity.backendState === "Running" &&
        identity.nodeId &&
        identity.loginName &&
        identity.tailnet
          ? JSON.stringify([identity.nodeId, identity.loginName, identity.tailnet])
          : "";
      if (next === scope && loaded) return;
      if (next !== scope) {
        invalidate();
        scope = next;
      }
      loaded = false;
      storageError = false;
      const epoch = revision;
      try {
        const saved = next ? await store?.read(next) : undefined;
        // 清除、退出或停止可抢先失效解密；迟到结果不能恢复旧账号凭据。
        if (revision === epoch) {
          key = saved ?? "";
          loaded = true;
        }
      } catch {
        if (revision === epoch) {
          key = "";
          loaded = true;
          storageError = true;
        }
      }
    },
    async save(value: string) {
      if (!scope) throw Error("device_bridge_management_account_required");
      const epoch = revision;
      try {
        await store?.save(scope, value);
      } catch {
        storageError = true;
        throw storageFailure();
      }
      if (revision === epoch) {
        key = value;
        storageError = false;
        loaded = true;
      }
    },
    async clear() {
      invalidate();
      try {
        await store?.clear();
        storageError = false;
      } catch {
        storageError = true;
        throw storageFailure();
      }
    },
  };
}
