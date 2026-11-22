import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type {
  CredentialVaultEntry,
  CredentialVaultScope,
  SaveCredentialVaultEntryInput,
} from "./credential.js";
import { initializeCredentialVaultSchema } from "./credentialVaultSchema.js";
import {
  mapCredentialVaultMutation,
  projectCredentialVaultRow,
  type CredentialVaultMutation,
  type CredentialVaultRow,
} from "./credentialVaultRows.js";
import {
  attachProjectEntry,
  credentialIsInScope,
  detachProjectEntry,
  findActiveSecret,
  listAttachableEntries,
  listEntriesByScope,
  listProjectEntries,
  listRuntimeAccessibleEntries,
  scopedPredicate,
} from "./credentialVaultProjectAttachments.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type CredentialVaultDatabase = InstanceType<typeof DatabaseSync>;

export class CredentialVaultRepository {
  private database: CredentialVaultDatabase | null = null;
  private initialization: Promise<void> | null = null;

  constructor(private readonly databasePath: string) {}

  async listActive(workspaceIdentity: string): Promise<CredentialVaultEntry[]> {
    return listProjectEntries(await this.getDatabase(), workspaceIdentity);
  }

  async listAttachable(workspaceIdentity: string): Promise<CredentialVaultEntry[]> {
    return listAttachableEntries(await this.getDatabase(), workspaceIdentity);
  }

  async listRuntimeAccessible(workspaceIdentity: string): Promise<CredentialVaultEntry[]> {
    return listRuntimeAccessibleEntries(await this.getDatabase(), workspaceIdentity);
  }

  async listUnassigned(): Promise<CredentialVaultEntry[]> {
    return listEntriesByScope(await this.getDatabase(), "unassigned");
  }

  async listGlobal(): Promise<CredentialVaultEntry[]> {
    return listEntriesByScope(await this.getDatabase(), "global");
  }

  async listAllActive(): Promise<CredentialVaultEntry[]> {
    return listEntriesByScope(await this.getDatabase(), null);
  }

  async findActiveSecret(
    id: string,
    workspaceIdentity: string,
  ): Promise<{ entry: CredentialVaultEntry; secretKey: string } | null> {
    return findActiveSecret(await this.getDatabase(), id, workspaceIdentity);
  }

  async attach(id: string, workspaceIdentity: string): Promise<void> {
    attachProjectEntry(await this.getDatabase(), id, workspaceIdentity);
  }

  async attachGlobal(id: string): Promise<void> {
    const database = await this.getDatabase();
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET scope = 'global', workspace_identity = NULL
         WHERE id = ? AND status = 'active' AND scope = 'unassigned'`,
      )
      .run(id);
    if (result.changes !== 1) throw new Error("Credential entry is missing or already assigned");
  }

  async detach(id: string, workspaceIdentity: string): Promise<void> {
    detachProjectEntry(await this.getDatabase(), id, workspaceIdentity);
  }

  async detachGlobal(id: string): Promise<void> {
    const database = await this.getDatabase();
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET scope = 'unassigned'
         WHERE id = ? AND status = 'active' AND scope = 'global'`,
      )
      .run(id);
    if (result.changes !== 1) throw new Error("Credential entry was not found in Global scope");
  }

  async find(id: string): Promise<CredentialVaultMutation | CredentialVaultEntry | null> {
    const database = await this.getDatabase();
    const row = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries WHERE id = ?`,
      )
      .get(id) as CredentialVaultRow | undefined;
    if (!row) return null;
    return mapCredentialVaultMutation(row) ?? projectCredentialVaultRow(row);
  }

  async isInScope(
    id: string,
    scope: CredentialVaultScope,
    workspaceIdentity: string | null,
  ): Promise<boolean> {
    return credentialIsInScope(await this.getDatabase(), id, scope, workspaceIdentity);
  }

  async reserveCreate(
    input: SaveCredentialVaultEntryInput,
    id: string,
    secretKey: string,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
    now: number,
  ): Promise<void> {
    const database = await this.getDatabase();
    this.transaction(database, () => {
      database
        .prepare(
          `INSERT INTO credential_vault_entries
            (id, name, kind, environment, host, port, username, scope, workspace_identity, secret_key,
             previous_secret_key, status, operation_owner_pid, operation_owner_started_at,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'creating', ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.kind,
          input.environment,
          input.host,
          input.port,
          input.username,
          input.scope,
          secretKey,
          operationOwnerPid,
          operationOwnerStartedAt,
          now,
          now,
        );
      if (input.scope === "project" && input.workspaceIdentity) {
        database
          .prepare(
            "INSERT INTO credential_vault_project_attachments (credential_id, workspace_identity, created_at) VALUES (?, ?, ?)",
          )
          .run(id, input.workspaceIdentity, now);
      }
    });
  }

  async activateCreate(id: string, now: number): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `UPDATE credential_vault_entries
         SET status = 'active', operation_owner_pid = NULL, operation_owner_started_at = NULL,
             updated_at = ?
         WHERE id = ? AND status = 'creating'`,
      )
      .run(now, id);
  }

  async beginRotate(
    id: string,
    scope: CredentialVaultScope,
    workspaceIdentity: string | null,
    secretKey: string,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
    now: number,
  ): Promise<string> {
    const database = await this.getDatabase();
    const predicate = scopedPredicate(scope, workspaceIdentity);
    return this.transaction(database, () => {
      const row = database
        .prepare(
          `SELECT secret_key FROM credential_vault_entries
           WHERE id = ? AND status = 'active' AND ${predicate.sql}`,
        )
        .get(id, ...predicate.params) as { secret_key: string } | undefined;
      if (!row) throw new Error("Credential entry is missing or busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET previous_secret_key = secret_key, secret_key = ?, status = 'rotating',
               operation_owner_pid = ?, operation_owner_started_at = ?, updated_at = ?
           WHERE id = ? AND status = 'active' AND ${predicate.sql}`,
        )
        .run(secretKey, operationOwnerPid, operationOwnerStartedAt, now, id, ...predicate.params);
      return row.secret_key;
    });
  }

  async completeRotate(id: string, now: number): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `UPDATE credential_vault_entries
         SET previous_secret_key = NULL, status = 'active', operation_owner_pid = NULL,
             operation_owner_started_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'rotating'`,
      )
      .run(now, id);
  }

  async rollbackRotate(id: string): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `UPDATE credential_vault_entries
         SET secret_key = previous_secret_key, previous_secret_key = NULL, status = 'active',
             operation_owner_pid = NULL, operation_owner_started_at = NULL
         WHERE id = ? AND status = 'rotating' AND previous_secret_key IS NOT NULL`,
      )
      .run(id);
  }

  async updateActive(
    input: SaveCredentialVaultEntryInput & { id: string },
    now: number,
  ): Promise<void> {
    const database = await this.getDatabase();
    const predicate = scopedPredicate(input.scope, input.workspaceIdentity);
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET name = ?, kind = ?, environment = ?, host = ?, port = ?, username = ?,
             scope = ?, workspace_identity = NULL, updated_at = ?
         WHERE id = ? AND status = 'active' AND ${predicate.sql}`,
      )
      .run(
        input.name,
        input.kind,
        input.environment,
        input.host,
        input.port,
        input.username,
        input.scope,
        now,
        input.id,
        ...predicate.params,
      );
    if (result.changes !== 1) throw new Error("Credential entry is missing or busy");
  }

  async beginDelete(
    id: string,
    scope: CredentialVaultScope,
    workspaceIdentity: string | null,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
  ): Promise<string | null> {
    const database = await this.getDatabase();
    const predicate = scopedPredicate(scope, workspaceIdentity);
    return this.transaction(database, () => {
      const row = database
        .prepare(
          `SELECT secret_key, status FROM credential_vault_entries
           WHERE id = ? AND ${predicate.sql}`,
        )
        .get(id, ...predicate.params) as
        | { secret_key: string; status: CredentialVaultRow["status"] }
        | undefined;
      if (!row) return null;
      if (row.status === "deleting") return row.secret_key;
      if (row.status !== "active") throw new Error("Credential entry is busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET status = 'deleting', operation_owner_pid = ?, operation_owner_started_at = ?
           WHERE id = ? AND status = 'active' AND ${predicate.sql}`,
        )
        .run(operationOwnerPid, operationOwnerStartedAt, id, ...predicate.params);
      return row.secret_key;
    });
  }

  async finishDelete(id: string): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare("DELETE FROM credential_vault_entries WHERE id = ? AND status = 'deleting'")
      .run(id);
  }

  async rollbackDelete(id: string): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `UPDATE credential_vault_entries
         SET status = 'active', operation_owner_pid = NULL, operation_owner_started_at = NULL
         WHERE id = ? AND status = 'deleting'`,
      )
      .run(id);
  }

  async deleteCreating(id: string): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare("DELETE FROM credential_vault_entries WHERE id = ? AND status = 'creating'")
      .run(id);
  }

  async releaseMutationOwner(id: string): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `UPDATE credential_vault_entries
         SET operation_owner_pid = NULL, operation_owner_started_at = NULL
         WHERE id = ? AND status != 'active'`,
      )
      .run(id);
  }

  async recoveryCandidates(): Promise<CredentialVaultMutation[]> {
    const database = await this.getDatabase();
    const rows = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries WHERE status != 'active'`,
      )
      .all() as unknown as CredentialVaultRow[];
    return rows
      .map(mapCredentialVaultMutation)
      .filter((row): row is CredentialVaultMutation => row !== null);
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.initialization = null;
  }

  private async getDatabase(): Promise<CredentialVaultDatabase> {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
    return this.database!;
  }

  private async initialize(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    this.database = database;
    try {
      initializeCredentialVaultSchema(database);
    } catch (error) {
      database.close();
      this.database = null;
      throw error;
    }
  }

  private transaction<T>(database: CredentialVaultDatabase, operation: () => T): T {
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
}
