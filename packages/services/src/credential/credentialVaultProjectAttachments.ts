import type { DatabaseSync } from "node:sqlite";
import type { CredentialVaultEntry, CredentialVaultScope } from "./credential.js";
import { projectCredentialVaultRow, type CredentialVaultRow } from "./credentialVaultRows.js";

type CredentialVaultDatabase = InstanceType<typeof DatabaseSync>;

export function scopedPredicate(scope: CredentialVaultScope, workspaceIdentity: string | null) {
  if (scope === "project" && workspaceIdentity) {
    return {
      sql: `scope = 'project' AND EXISTS (
        SELECT 1 FROM credential_vault_project_attachments a
        WHERE a.credential_id = credential_vault_entries.id AND a.workspace_identity = ?
      )`,
      params: [workspaceIdentity],
    };
  }
  return { sql: "scope = ? AND workspace_identity IS ?", params: [scope, workspaceIdentity] };
}

function transaction<T>(database: CredentialVaultDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listProjectEntries(
  database: CredentialVaultDatabase,
  workspaceIdentity: string,
): CredentialVaultEntry[] {
  const rows = database
    .prepare(
      `SELECT id, name, kind, environment, host, port, username, scope,
              ? AS workspace_identity, secret_key, previous_secret_key, status,
              operation_owner_pid, operation_owner_started_at, created_at, updated_at
       FROM credential_vault_entries
       WHERE status = 'active' AND scope = 'project' AND EXISTS (
         SELECT 1 FROM credential_vault_project_attachments a
         WHERE a.credential_id = credential_vault_entries.id AND a.workspace_identity = ?
       )
       ORDER BY updated_at DESC, id`,
    )
    .all(workspaceIdentity, workspaceIdentity) as unknown as CredentialVaultRow[];
  return rows.map(projectCredentialVaultRow);
}

export function listAttachableEntries(
  database: CredentialVaultDatabase,
  workspaceIdentity: string,
): CredentialVaultEntry[] {
  const rows = database
    .prepare(
      `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
              secret_key, previous_secret_key, status, operation_owner_pid,
              operation_owner_started_at, created_at, updated_at
       FROM credential_vault_entries e
       WHERE status = 'active' AND scope IN ('unassigned', 'project')
         AND NOT EXISTS (
           SELECT 1 FROM credential_vault_project_attachments a
           WHERE a.credential_id = e.id AND a.workspace_identity = ?
         )
       ORDER BY updated_at DESC, id`,
    )
    .all(workspaceIdentity) as unknown as CredentialVaultRow[];
  return rows.map(projectCredentialVaultRow);
}

export function listRuntimeAccessibleEntries(
  database: CredentialVaultDatabase,
  workspaceIdentity: string,
): CredentialVaultEntry[] {
  const rows = database
    .prepare(
      `SELECT id, name, kind, environment, host, port, username, scope,
              CASE WHEN scope = 'project' THEN ? ELSE NULL END AS workspace_identity,
              secret_key, previous_secret_key, status, operation_owner_pid,
              operation_owner_started_at, created_at, updated_at
       FROM credential_vault_entries e
       WHERE status = 'active' AND (scope = 'global' OR (scope = 'project' AND EXISTS (
         SELECT 1 FROM credential_vault_project_attachments a
         WHERE a.credential_id = e.id AND a.workspace_identity = ?
       )))
       ORDER BY updated_at DESC, id`,
    )
    .all(workspaceIdentity, workspaceIdentity) as unknown as CredentialVaultRow[];
  return rows.map(projectCredentialVaultRow);
}

export function listEntriesByScope(
  database: CredentialVaultDatabase,
  scope: CredentialVaultScope | null,
): CredentialVaultEntry[] {
  const rows = database
    .prepare(
      `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
              secret_key, previous_secret_key, status, operation_owner_pid,
              operation_owner_started_at, created_at, updated_at
       FROM credential_vault_entries
       WHERE status = 'active' ${scope ? "AND scope = ?" : ""}
       ORDER BY updated_at DESC, id`,
    )
    .all(...(scope ? [scope] : [])) as unknown as CredentialVaultRow[];
  return rows.map(projectCredentialVaultRow);
}

export function credentialIsInScope(
  database: CredentialVaultDatabase,
  id: string,
  scope: CredentialVaultScope,
  workspaceIdentity: string | null,
): boolean {
  const predicate = scopedPredicate(scope, workspaceIdentity);
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM credential_vault_entries WHERE id = ? AND status = 'active' AND ${predicate.sql}`,
      )
      .get(id, ...predicate.params),
  );
}

export function findActiveSecret(
  database: CredentialVaultDatabase,
  id: string,
  workspaceIdentity: string,
): { entry: CredentialVaultEntry; secretKey: string } | null {
  const row = database
    .prepare(
      `SELECT id, name, kind, environment, host, port, username, scope,
              CASE WHEN scope = 'project' THEN ? ELSE NULL END AS workspace_identity,
              secret_key, previous_secret_key, status, operation_owner_pid,
              operation_owner_started_at, created_at, updated_at
       FROM credential_vault_entries
       WHERE id = ? AND status = 'active'
         AND (scope = 'global' OR (scope = 'project' AND EXISTS (
           SELECT 1 FROM credential_vault_project_attachments a
           WHERE a.credential_id = credential_vault_entries.id AND a.workspace_identity = ?
         )))`,
    )
    .get(workspaceIdentity, id, workspaceIdentity) as CredentialVaultRow | undefined;
  return row ? { entry: projectCredentialVaultRow(row), secretKey: row.secret_key } : null;
}

export function attachProjectEntry(
  database: CredentialVaultDatabase,
  id: string,
  workspaceIdentity: string,
): void {
  transaction(database, () => {
    const row = database
      .prepare("SELECT scope FROM credential_vault_entries WHERE id = ? AND status = 'active'")
      .get(id) as { scope: CredentialVaultEntry["scope"] } | undefined;
    if (!row || !["unassigned", "project"].includes(row.scope)) {
      throw new Error("Credential entry is missing or cannot be attached to a project");
    }
    database
      .prepare(
        "INSERT OR IGNORE INTO credential_vault_project_attachments (credential_id, workspace_identity, created_at) VALUES (?, ?, ?)",
      )
      .run(id, workspaceIdentity, Date.now());
    database
      .prepare(
        "UPDATE credential_vault_entries SET scope = 'project', workspace_identity = NULL WHERE id = ? AND status = 'active'",
      )
      .run(id);
  });
}

export function detachProjectEntry(
  database: CredentialVaultDatabase,
  id: string,
  workspaceIdentity: string,
): void {
  transaction(database, () => {
    const result = database
      .prepare(
        `DELETE FROM credential_vault_project_attachments
         WHERE credential_id = ? AND workspace_identity = ?
           AND EXISTS (SELECT 1 FROM credential_vault_entries e WHERE e.id = ? AND e.status = 'active' AND e.scope = 'project')`,
      )
      .run(id, workspaceIdentity, id);
    if (result.changes !== 1) throw new Error("Credential entry was not found in this project");
    const remaining = database
      .prepare("SELECT 1 FROM credential_vault_project_attachments WHERE credential_id = ? LIMIT 1")
      .get(id);
    if (!remaining) {
      database
        .prepare(
          "UPDATE credential_vault_entries SET scope = 'unassigned' WHERE id = ? AND status = 'active' AND scope = 'project'",
        )
        .run(id);
    }
  });
}
