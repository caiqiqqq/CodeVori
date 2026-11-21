import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { credentialKeySchema, credentialValueSchema } from "@zcode/shared";
import type { CredentialVaultEntry, ICredentialService } from "./credential.js";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./providers/credentialCipherProvider.js";
import { getAppConfigDir } from "../paths.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { CredentialVaultRepository } from "./credentialVaultRepository.js";
import { readCredentials, writeCredential } from "./credentialStoreFile.js";
import type {
  CredentialVaultReference,
  CredentialVaultReferenceReader,
} from "./credentialVaultReferenceReader.js";

/**
 * 凭据存储路径
 *
 * 当前持久化格式仍是 JSON，但 value 会在写入前加密，读取时自动解密。
 * 后续可切换到 Electron safeStorage（钥匙串）托管密钥，
 * 届时 host process 需要向 main 进程请求 encrypt/decrypt。
 */
const CREDENTIAL_VAULT_SECRET_PREFIX = "credential-vault:";
const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1_000);
const logger = createServiceLogger("credentialService");
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
    scope: z.enum(["unassigned", "global", "project"]),
    workspaceIdentity: z.string().trim().min(1).max(2_048).nullable(),
    secret: z.string().max(16_384).optional(),
  })
  .superRefine((input, context) => {
    const requiresIdentity = input.scope === "project";
    if (requiresIdentity !== (input.workspaceIdentity !== null)) {
      context.addIssue({
        code: "custom",
        message: "Project credentials require an identity; other scopes do not use one",
        path: ["workspaceIdentity"],
      });
    }
  })
  .strict();

interface CredentialServiceDependencies {
  cipherProvider?: CredentialCipherProvider;
  vaultRepository?: CredentialVaultRepository;
  /** Host 私有的持久化成功通知；不进入 Renderer/RPC 凭据接口。 */
  onDidMutate?: (event: { operation: "save" | "delete"; key: string }) => void;
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
  return createCredentialServiceWithReferenceReader(dependencies).service;
}

export interface CredentialServiceWithReferenceReader {
  service: ICredentialService;
  credentialVaultReferenceReader: CredentialVaultReferenceReader;
  listVaultMetadata(workspaceIdentity: string): Promise<CredentialVaultEntry[]>;
}

export function createCredentialServiceWithReferenceReader(
  dependencies: CredentialServiceDependencies = {},
): CredentialServiceWithReferenceReader {
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

  const load = async (key: string, assertCurrent?: () => void): Promise<string | null> => {
    const validatedKey = credentialKeySchema.parse(key);
    const creds = await readCredentials();
    assertCurrent?.();
    const rawValue = creds[validatedKey];
    return rawValue === undefined ? null : cipherProvider.decrypt(rawValue);
  };

  const save = async (key: string, value: string): Promise<void> => {
    const validatedKey = credentialKeySchema.parse(key);
    const validatedValue = credentialValueSchema.parse(value);
    const encryptedValue = cipherProvider.encrypt(validatedValue);
    await writeCredential(validatedKey, encryptedValue);
    dependencies.onDidMutate?.({ operation: "save", key: validatedKey });
  };

  const del = async (key: string): Promise<void> => {
    const validatedKey = credentialKeySchema.parse(key);
    await writeCredential(validatedKey, null);
    dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
  };

  const service: ICredentialService = {
    load,
    save,
    delete: del,

    async listUnassignedVaultEntries() {
      await recoverVaultMutations();
      return vaultRepository.listUnassigned();
    },

    async listAttachableVaultEntries(workspaceIdentity) {
      const identity = z.string().trim().min(1).max(2_048).parse(workspaceIdentity);
      await recoverVaultMutations();
      return vaultRepository.listAttachable(identity);
    },

    async listGlobalVaultEntries() {
      await recoverVaultMutations();
      return vaultRepository.listGlobal();
    },

    async listVaultEntries(workspaceIdentity) {
      const scope = z.string().trim().min(1).max(2_048).parse(workspaceIdentity);
      await recoverVaultMutations();
      return vaultRepository.listActive(scope);
    },

    async saveVaultEntry(rawInput) {
      const input = credentialVaultInputSchema.parse(rawInput);
      await recoverVaultMutations();
      const id = input.id ?? randomUUID();
      const existing = input.id ? await vaultRepository.find(id) : null;
      if (input.id && !existing) throw new Error("Credential entry was not found");
      if (existing && "status" in existing) throw new Error("Credential entry is busy");
      // Renderer 的项目筛选只负责展示；Host 写操作仍需独立校验归属。
      if (
        existing &&
        !(await vaultRepository.isInScope(id, input.scope, input.workspaceIdentity))
      ) {
        // 中文依据：全局凭证会投影到项目列表，但只有 Global scope 能修改其归属和内容。
        throw new Error("Credential entry was not found in this scope");
      }

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
          input.scope,
          input.workspaceIdentity,
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
      return {
        ...savedEntry,
        workspaceIdentity: input.scope === "project" ? input.workspaceIdentity : null,
      };
    },

    async attachVaultEntry(id, workspaceIdentity) {
      const validatedId = z.string().uuid().parse(id);
      const validatedWorkspaceIdentity = z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .parse(workspaceIdentity);
      await recoverVaultMutations();
      await vaultRepository.attach(validatedId, validatedWorkspaceIdentity);
    },

    async attachVaultEntryGlobally(id) {
      const validatedId = z.string().uuid().parse(id);
      await recoverVaultMutations();
      await vaultRepository.attachGlobal(validatedId);
    },

    async detachVaultEntry(id, workspaceIdentity) {
      const validatedId = z.string().uuid().parse(id);
      const validatedWorkspaceIdentity = z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .parse(workspaceIdentity);
      await recoverVaultMutations();
      await vaultRepository.detach(validatedId, validatedWorkspaceIdentity);
    },

    async detachGlobalVaultEntry(id) {
      const validatedId = z.string().uuid().parse(id);
      await recoverVaultMutations();
      await vaultRepository.detachGlobal(validatedId);
    },

    async deleteVaultEntry(id, scope, workspaceIdentity) {
      const validatedId = z.string().uuid().parse(id);
      const validatedScope = z.enum(["unassigned", "global", "project"]).parse(scope);
      const validatedWorkspaceIdentity = z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .nullable()
        .parse(workspaceIdentity);
      await recoverVaultMutations();
      const existing = await vaultRepository.find(validatedId);
      if (existing && "status" in existing) throw new Error("Credential entry is busy");
      // 删除同样必须校验项目归属，避免只靠 UI 隐藏条目形成越权边界。
      if (
        existing &&
        !(await vaultRepository.isInScope(validatedId, validatedScope, validatedWorkspaceIdentity))
      ) {
        // 中文依据：workspaceIdentity 为 null 时还需比较 scope，防止未分配凭证与全局凭证互相越权。
        throw new Error("Credential entry was not found in this scope");
      }
      const secretKey = await vaultRepository.beginDelete(
        validatedId,
        validatedScope,
        validatedWorkspaceIdentity,
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

  const credentialVaultReferenceReader: CredentialVaultReferenceReader = {
    async listReferences(rawWorkspaceIdentity) {
      const identity = z.string().trim().min(1).max(2_048).parse(rawWorkspaceIdentity);
      await recoverVaultMutations();
      return (await vaultRepository.listRuntimeAccessible(identity)).map(projectReference);
    },
    async readSecret(rawWorkspaceIdentity, reference, assertCurrent) {
      const identity = z.string().trim().min(1).max(2_048).parse(rawWorkspaceIdentity);
      const id = z.string().uuid().parse(reference.id);
      const unavailable = () => new Error("Saved credential is unavailable or has changed");
      assertCurrent();
      const saved = await vaultRepository.findActiveSecret(id, identity);
      assertCurrent();
      if (
        !saved ||
        JSON.stringify(projectReference(saved.entry)) !==
          JSON.stringify(projectReference(reference))
      ) {
        throw unavailable();
      }
      const secret = await load(saved.secretKey, assertCurrent);
      const current = await vaultRepository.findActiveSecret(id, identity);
      assertCurrent();
      if (
        secret === null ||
        !current ||
        current.secretKey !== saved.secretKey ||
        JSON.stringify(current.entry) !== JSON.stringify(saved.entry)
      ) {
        throw unavailable();
      }
      return { ...projectReference(current.entry), secret };
    },
  };

  return {
    service,
    credentialVaultReferenceReader,
    listVaultMetadata: (workspaceIdentity) =>
      vaultRepository.listRuntimeAccessible(
        z.string().trim().min(1).max(2_048).parse(workspaceIdentity),
      ),
  };
}

function projectReference({
  id,
  name,
  kind,
  environment,
  host,
  port,
  username,
}: CredentialVaultReference): CredentialVaultReference {
  return { id, name, kind, environment, host, port, username };
}
