import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
  CredentialVaultScope,
} from "./credential.js";

export interface CredentialVaultRow {
  id: string;
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
  scope: CredentialVaultScope;
  workspace_identity: string | null;
  secret_key: string;
  previous_secret_key: string | null;
  status: "creating" | "active" | "rotating" | "deleting";
  operation_owner_pid: number | null;
  operation_owner_started_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CredentialVaultMutation {
  id: string;
  status: Exclude<CredentialVaultRow["status"], "active">;
  secretKey: string;
  previousSecretKey: string | null;
  operationOwnerPid: number | null;
  operationOwnerStartedAt: number | null;
}

export function projectCredentialVaultRow(row: CredentialVaultRow): CredentialVaultEntry {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    environment: row.environment,
    host: row.host,
    port: row.port,
    username: row.username,
    scope: row.scope,
    workspaceIdentity: row.workspace_identity,
    hasSecret: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCredentialVaultMutation(
  row: CredentialVaultRow,
): CredentialVaultMutation | null {
  if (row.status === "active") return null;
  return {
    id: row.id,
    status: row.status,
    secretKey: row.secret_key,
    previousSecretKey: row.previous_secret_key,
    operationOwnerPid: row.operation_owner_pid,
    operationOwnerStartedAt: row.operation_owner_started_at,
  };
}
