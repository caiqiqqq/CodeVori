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

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type CredentialVaultDatabase = InstanceType<typeof DatabaseSync>;

export class CredentialVaultRepository {
  private database: CredentialVaultDatabase | null = null;
  private initialization: Promise<void> | null = null;

  constructor(private readonly databasePath: string) {}

  async listActive(workspaceIdentity: string): Promise<CredentialVaultEntry[]> {
    const database = await this.getDatabase();
    const rows = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries
         WHERE status = 'active' AND (scope = 'global' OR
               (scope = 'project' AND workspace_identity = ?))
         ORDER BY updated_at DESC, id`,
      )
      .all(workspaceIdentity) as unknown as CredentialVaultRow[];
    return rows.map(projectCredentialVaultRow);
  }

  async listUnassigned(): Promise<CredentialVaultEntry[]> {
    const database = await this.getDatabase();
    const rows = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries
         WHERE status = 'active' AND scope = 'unassigned'
         ORDER BY updated_at DESC, id`,
      )
      .all() as unknown as CredentialVaultRow[];
    return rows.map(projectCredentialVaultRow);
  }

  async listGlobal(): Promise<CredentialVaultEntry[]> {
    const database = await this.getDatabase();
    const rows = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries
         WHERE status = 'active' AND scope = 'global'
         ORDER BY updated_at DESC, id`,
      )
      .all() as unknown as CredentialVaultRow[];
    return rows.map(projectCredentialVaultRow);
  }

  async attach(id: string, workspaceIdentity: string): Promise<void> {
    const database = await this.getDatabase();
    // 同一 SQL 条件更新避免两个项目并发把同一条未关联凭证同时认领。
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET scope = 'project', workspace_identity = ?
         WHERE id = ? AND status = 'active' AND scope = 'unassigned'`,
      )
      .run(workspaceIdentity, id);
    if (result.changes !== 1) throw new Error("Credential entry is missing or already attached");
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
    const database = await this.getDatabase();
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET scope = 'unassigned', workspace_identity = NULL
         WHERE id = ? AND status = 'active' AND scope = 'project' AND workspace_identity = ?`,
      )
      .run(id, workspaceIdentity);
    if (result.changes !== 1) throw new Error("Credential entry was not found in this project");
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

  async reserveCreate(
    input: SaveCredentialVaultEntryInput,
    id: string,
    secretKey: string,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
    now: number,
  ): Promise<void> {
    const database = await this.getDatabase();
    database
      .prepare(
        `INSERT INTO credential_vault_entries
          (id, name, kind, environment, host, port, username, scope, workspace_identity, secret_key,
           previous_secret_key, status, operation_owner_pid, operation_owner_started_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'creating', ?, ?, ?, ?)`,
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
        input.workspaceIdentity,
        secretKey,
        operationOwnerPid,
        operationOwnerStartedAt,
        now,
        now,
      );
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
    return this.transaction(database, () => {
      const row = database
        .prepare(
          `SELECT secret_key FROM credential_vault_entries
           WHERE id = ? AND status = 'active' AND scope = ? AND workspace_identity IS ?`,
        )
        .get(id, scope, workspaceIdentity) as { secret_key: string } | undefined;
      if (!row) throw new Error("Credential entry is missing or busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET previous_secret_key = secret_key, secret_key = ?, status = 'rotating',
               operation_owner_pid = ?, operation_owner_started_at = ?, updated_at = ?
           WHERE id = ? AND status = 'active' AND scope = ? AND workspace_identity IS ?`,
        )
        .run(
          secretKey,
          operationOwnerPid,
          operationOwnerStartedAt,
          now,
          id,
          scope,
          workspaceIdentity,
        );
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
    const result = database
      .prepare(
        `UPDATE credential_vault_entries
         SET name = ?, kind = ?, environment = ?, host = ?, port = ?, username = ?,
             scope = ?, workspace_identity = ?, updated_at = ?
         WHERE id = ? AND status = 'active' AND scope = ? AND workspace_identity IS ?`,
      )
      .run(
        input.name,
        input.kind,
        input.environment,
        input.host,
        input.port,
        input.username,
        input.scope,
        input.workspaceIdentity,
        now,
        input.id,
        input.scope,
        input.workspaceIdentity,
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
    return this.transaction(database, () => {
      const row = database
        .prepare(
          `SELECT secret_key, status FROM credential_vault_entries
           WHERE id = ? AND scope = ? AND workspace_identity IS ?`,
        )
        .get(id, scope, workspaceIdentity) as
        | { secret_key: string; status: CredentialVaultRow["status"] }
        | undefined;
      if (!row) return null;
      if (row.status === "deleting") return row.secret_key;
      if (row.status !== "active") throw new Error("Credential entry is busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET status = 'deleting', operation_owner_pid = ?, operation_owner_started_at = ?
           WHERE id = ? AND status = 'active' AND scope = ? AND workspace_identity IS ?`,
        )
        .run(operationOwnerPid, operationOwnerStartedAt, id, scope, workspaceIdentity);
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
