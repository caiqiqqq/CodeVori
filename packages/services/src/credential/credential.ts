import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { ProjectEnvironmentService } from "./projectEnvironment.js";

/**
 * 凭据管理服务
 *
 * 提供 key-value 形式的凭据读写。
 * 实现端（host process）负责加密存储细节，
 * 消费端（renderer）只通过 RPC 调用，不感知存储位置。
 */
export interface ICredentialService extends Partial<ProjectEnvironmentService> {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listUnassignedVaultEntries?(): Promise<CredentialVaultEntry[]>;
  listAttachableVaultEntries?(workspaceIdentity: string): Promise<CredentialVaultEntry[]>;
  listGlobalVaultEntries?(): Promise<CredentialVaultEntry[]>;
  listVaultEntries?(workspaceIdentity: string): Promise<CredentialVaultEntry[]>;
  saveVaultEntry?(input: SaveCredentialVaultEntryInput): Promise<CredentialVaultEntry>;
  attachVaultEntry?(id: string, workspaceIdentity: string): Promise<void>;
  attachVaultEntryGlobally?(id: string): Promise<void>;
  detachVaultEntry?(id: string, workspaceIdentity: string): Promise<void>;
  detachGlobalVaultEntry?(id: string): Promise<void>;
  deleteVaultEntry?(
    id: string,
    scope: CredentialVaultScope,
    workspaceIdentity: string | null,
  ): Promise<void>;
}

export type CredentialVaultKind = string;
export type CredentialVaultEnvironment = "development" | "test" | "staging" | "production";
export type CredentialVaultScope = "unassigned" | "global" | "project";

export interface CredentialVaultEntry {
  id: string;
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
  scope: CredentialVaultScope;
  workspaceIdentity: string | null;
  hasSecret: true;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCredentialVaultEntryInput {
  id?: string;
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
  scope: CredentialVaultScope;
  workspaceIdentity: string | null;
  /** Omitted or empty on edit means keep the current secret. */
  secret?: string;
}

export const ICredentialService = createServiceDescriptor<ICredentialService>(
  ServiceChannels.Credential,
);
