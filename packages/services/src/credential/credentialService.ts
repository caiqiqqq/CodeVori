import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@zcode/shared/node";
import {
  credentialKeySchema,
  credentialRecordSchema,
  credentialValueSchema,
  formatZodError,
} from "@zcode/shared";
import type { ICredentialService } from "./credential.js";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./providers/credentialCipherProvider.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";
import { CredentialVaultRepository } from "./credentialVaultRepository.js";
import type { CredentialVaultServerReader } from "./credentialVaultServerReader.js";

/**
 * 凭据存储路径
 *
 * 当前持久化格式仍是 JSON，但 value 会在写入前加密，读取时自动解密。
 * 后续可切换到 Electron safeStorage（钥匙串）托管密钥，
 * 届时 host process 需要向 main 进程请求 encrypt/decrypt。
 */
const logger = createServiceLogger("credentialService");
const CREDENTIAL_VAULT_SECRET_PREFIX = "credential-vault:";
const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1_000);
const credentialVaultInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    kind: z.string().trim().min(1).max(80),
    environment: z.enum(["development", "test", "staging", "production"]),
    host: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/[\s/@?#]/u.test(value), "Enter a host name or address, not a URL"),
    port: z.number().int().min(1).max(65_535).nullable(),
    username: z.string().trim().max(255).nullable(),
    workspaceIdentity: z.string().trim().max(2_048).nullable(),
    secret: z.string().max(16_384).optional(),
  })
  .strict();

function getCredentialsDir() {
  return getAppConfigDir();
}

function getCredentialsFile() {
  return join(getCredentialsDir(), "credentials.json");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function readAll(credentialsFile = getCredentialsFile()): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(credentialsFile, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read CodeVori credentials: ${credentialsFile}`, { cause: error });
  }

  try {
    const rawValue = JSON.parse(raw);
    const result = credentialRecordSchema.safeParse(rawValue);
    if (!result.success) {
      throw new Error(formatZodError(result.error));
    }
    return result.data;
  } catch (error) {
    // 把损坏 JSON/schema 当成空 store 后继续 save 会清空其他 OAuth 与登录凭据。
    // 保留损坏文件证据并向上传递错误，禁止自动覆盖。
    const backupPath = await backupCorruptFile(credentialsFile).catch(() => undefined);
    // 服务层日志必须统一经过分级 logger，确保生产环境的损坏凭据告警
    // 进入相同的落盘/采集策略，同时不记录凭据内容。
    logger.warn(undefined, "read failed; refusing to overwrite corrupt credential store", {
      backupPath,
      credentialsFile,
    });
    throw new Error(`CodeVori credentials are corrupt: ${credentialsFile}`, { cause: error });
  }
}

async function writeAll(credentialsFile: string, data: Record<string, string>): Promise<void> {
  // 凭据路径之前在模块加载时就绑定到 homedir()，
  // Windows 测试里即使切换 HOME 也会继续写真实用户目录，导致隔离失效。
  await atomicWritePrivateTextFile(credentialsFile, `${JSON.stringify(data, null, 2)}\n`);
}

interface CredentialServiceDependencies {
  cipherProvider?: CredentialCipherProvider;
  vaultRepository?: CredentialVaultRepository;
  /** Host 私有的持久化成功通知；不进入 Renderer/RPC 凭据接口。 */
  onDidMutate?: (event: { operation: "save" | "delete"; key: string }) => void;
}

export interface CredentialServiceWithServerReader {
  service: ICredentialService;
  credentialVaultServerReader: CredentialVaultServerReader;
}

function hasLiveMutationOwner(pid: number | null, startedAt: number | null): boolean {
  if (!pid) return false;
  if (pid === process.pid) return startedAt === PROCESS_STARTED_AT;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createCredentialService(
  dependencies: CredentialServiceDependencies = {},
): ICredentialService {
  return createCredentialServiceWithServerReader(dependencies).service;
}

export function createCredentialServiceWithServerReader(
  dependencies: CredentialServiceDependencies = {},
): CredentialServiceWithServerReader {
  const cipherProvider = dependencies.cipherProvider ?? createCredentialCipherProvider();
  const vaultRepository =
    dependencies.vaultRepository ??
    new CredentialVaultRepository(join(getAppConfigDir(), "credential-vault.sqlite"));

  // SQLite keeps a durable operation state around the existing encrypted credential file so
  // interrupted create, rotation, and delete steps can be resumed without exposing the secret.
  const recoverVaultMutations = async () => {
    const mutations = await vaultRepository.recoveryCandidates();
    for (const mutation of mutations) {
      if (hasLiveMutationOwner(mutation.operationOwnerPid, mutation.operationOwnerStartedAt)) {
        continue;
      }

      try {
        if (mutation.status === "creating") {
          await del(mutation.secretKey);
          await vaultRepository.deleteCreating(mutation.id);
        } else if (mutation.status === "deleting") {
          await del(mutation.secretKey);
          await vaultRepository.finishDelete(mutation.id);
        } else if (mutation.status === "rotating") {
          const replacement = await load(mutation.secretKey);
          if (replacement !== null && mutation.previousSecretKey) {
            await del(mutation.previousSecretKey);
            await vaultRepository.completeRotate(mutation.id, Date.now());
          } else if (mutation.previousSecretKey) {
            await vaultRepository.rollbackRotate(mutation.id);
            await del(mutation.secretKey);
          }
        }
      } catch (error) {
        await vaultRepository.releaseMutationOwner(mutation.id).catch(() => undefined);
        logger.warn(undefined, "credential vault mutation recovery deferred", {
          entryId: mutation.id,
          status: mutation.status,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  };

  const load = async (key: string): Promise<string | null> => {
    const validatedKey = credentialKeySchema.parse(key);
    const creds = await readAll();
    const rawValue = creds[validatedKey];
    return rawValue === undefined ? null : cipherProvider.decrypt(rawValue);
  };

  const save = async (key: string, value: string): Promise<void> => {
    const validatedKey = credentialKeySchema.parse(key);
    const validatedValue = credentialValueSchema.parse(value);
    const encryptedValue = cipherProvider.encrypt(validatedValue);
    const credentialsFile = getCredentialsFile();
    await withFileLock(credentialsFile, async () => {
      const creds = await readAll(credentialsFile);
      creds[validatedKey] = encryptedValue;
      await writeAll(credentialsFile, creds);
    });
    dependencies.onDidMutate?.({ operation: "save", key: validatedKey });
  };

  const del = async (key: string): Promise<void> => {
    const validatedKey = credentialKeySchema.parse(key);
    const credentialsFile = getCredentialsFile();
    await withFileLock(credentialsFile, async () => {
      const creds = await readAll(credentialsFile);
      delete creds[validatedKey];
      await writeAll(credentialsFile, creds);
    });
    dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
  };

  const service: ICredentialService = {
    load,
    save,
    delete: del,

    async listVaultEntries() {
      await recoverVaultMutations();
      return vaultRepository.listActive();
    },

    async saveVaultEntry(rawInput) {
      const input = credentialVaultInputSchema.parse(rawInput);
      await recoverVaultMutations();
      const id = input.id ?? randomUUID();
      const existing = input.id ? await vaultRepository.find(id) : null;
      if (input.id && !existing) throw new Error("Credential entry was not found");
      if (existing && "status" in existing) throw new Error("Credential entry is busy");

      const secretValue = input.secret;
      if (!existing) {
        if (!secretValue) throw new Error("A secret is required for a new credential");
        const secretKey = `${CREDENTIAL_VAULT_SECRET_PREFIX}${randomUUID()}`;
        await vaultRepository.reserveCreate(
          input,
          id,
          secretKey,
          process.pid,
          PROCESS_STARTED_AT,
          Date.now(),
        );
        try {
          await save(secretKey, secretValue);
          await vaultRepository.activateCreate(id, Date.now());
        } catch (error) {
          await vaultRepository.releaseMutationOwner(id).catch(() => undefined);
          throw error;
        }
      } else if (secretValue) {
        const secretKey = `${CREDENTIAL_VAULT_SECRET_PREFIX}${randomUUID()}`;
        const oldSecretKey = await vaultRepository.beginRotate(
          id,
          secretKey,
          process.pid,
          PROCESS_STARTED_AT,
          Date.now(),
        );
        try {
          await save(secretKey, secretValue);
          await del(oldSecretKey);
          await vaultRepository.completeRotate(id, Date.now());
        } catch (error) {
          await vaultRepository.releaseMutationOwner(id).catch(() => undefined);
          throw error;
        }
        await vaultRepository.updateActive({ ...input, id, secret: undefined }, Date.now());
      } else {
        await vaultRepository.updateActive({ ...input, id }, Date.now());
      }

      const savedEntry = await vaultRepository.find(id);
      if (!savedEntry || "status" in savedEntry) {
        throw new Error("Credential entry is not ready");
      }
      return savedEntry;
    },

    async deleteVaultEntry(id) {
      const validatedId = z.string().uuid().parse(id);
      await recoverVaultMutations();
      const secretKey = await vaultRepository.beginDelete(
        validatedId,
        process.pid,
        PROCESS_STARTED_AT,
      );
      if (!secretKey) return;
      try {
        await del(secretKey);
        await vaultRepository.finishDelete(validatedId);
      } catch (error) {
        try {
          if ((await load(secretKey)) === null) {
            await vaultRepository.finishDelete(validatedId);
          } else {
            await vaultRepository.rollbackDelete(validatedId);
          }
        } catch {
          await vaultRepository.releaseMutationOwner(validatedId).catch(() => undefined);
        }
        throw error;
      }
    },
  };

  const credentialVaultServerReader: CredentialVaultServerReader = {
    async listServers(rawWorkspaceIdentity) {
      const identity = z.string().trim().min(1).max(2_048).parse(rawWorkspaceIdentity);
      await recoverVaultMutations();
      return (await vaultRepository.listActive())
        .filter(
          (entry) =>
            entry.kind === "server" &&
            (entry.workspaceIdentity === null || entry.workspaceIdentity === identity),
        )
        .map(({ name, environment, host, port, username }) => ({
          name,
          environment,
          host,
          port,
          username,
        }));
    },
  };

  return { service, credentialVaultServerReader };
}
