import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
  SaveCredentialVaultEntryInput,
} from "./credential.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type CredentialVaultDatabase = InstanceType<typeof DatabaseSync>;

const DATABASE_BUSY_TIMEOUT_MS = 5_000;

interface CredentialVaultRow {
  id: string;
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
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

function projectEntry(row: CredentialVaultRow): CredentialVaultEntry {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    environment: row.environment,
    host: row.host,
    port: row.port,
    username: row.username,
    workspaceIdentity: row.workspace_identity,
    hasSecret: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMutation(row: CredentialVaultRow): CredentialVaultMutation | null {
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

export class CredentialVaultRepository {
  private database: CredentialVaultDatabase | null = null;
  private initialization: Promise<void> | null = null;

  constructor(private readonly databasePath: string) {}

  async listActive(): Promise<CredentialVaultEntry[]> {
    const database = await this.getDatabase();
    const rows = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries WHERE status = 'active' ORDER BY updated_at DESC, id`,
      )
      .all() as unknown as CredentialVaultRow[];
    return rows.map(projectEntry);
  }

  async find(id: string): Promise<CredentialVaultMutation | CredentialVaultEntry | null> {
    const database = await this.getDatabase();
    const row = database
      .prepare(
        `SELECT id, name, kind, environment, host, port, username, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries WHERE id = ?`,
      )
      .get(id) as CredentialVaultRow | undefined;
    if (!row) return null;
    return mapMutation(row) ?? projectEntry(row);
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
          (id, name, kind, environment, host, port, username, workspace_identity, secret_key,
           previous_secret_key, status, operation_owner_pid, operation_owner_started_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'creating', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.kind,
        input.environment,
        input.host,
        input.port,
        input.username,
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
    secretKey: string,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
    now: number,
  ): Promise<string> {
    const database = await this.getDatabase();
    return this.transaction(database, () => {
      const row = database
        .prepare(
          `SELECT secret_key FROM credential_vault_entries WHERE id = ? AND status = 'active'`,
        )
        .get(id) as { secret_key: string } | undefined;
      if (!row) throw new Error("Credential entry is missing or busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET previous_secret_key = secret_key, secret_key = ?, status = 'rotating',
               operation_owner_pid = ?, operation_owner_started_at = ?, updated_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(secretKey, operationOwnerPid, operationOwnerStartedAt, now, id);
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
             workspace_identity = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(
        input.name,
        input.kind,
        input.environment,
        input.host,
        input.port,
        input.username,
        input.workspaceIdentity,
        now,
        input.id,
      );
    if (result.changes !== 1) throw new Error("Credential entry is missing or busy");
  }

  async beginDelete(
    id: string,
    operationOwnerPid: number,
    operationOwnerStartedAt: number,
  ): Promise<string | null> {
    const database = await this.getDatabase();
    return this.transaction(database, () => {
      const row = database
        .prepare(`SELECT secret_key, status FROM credential_vault_entries WHERE id = ?`)
        .get(id) as { secret_key: string; status: CredentialVaultRow["status"] } | undefined;
      if (!row) return null;
      if (row.status === "deleting") return row.secret_key;
      if (row.status !== "active") throw new Error("Credential entry is busy");
      database
        .prepare(
          `UPDATE credential_vault_entries
           SET status = 'deleting', operation_owner_pid = ?, operation_owner_started_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(operationOwnerPid, operationOwnerStartedAt, id);
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
        `SELECT id, name, kind, environment, host, port, username, workspace_identity,
                secret_key, previous_secret_key, status, operation_owner_pid,
                operation_owner_started_at, created_at, updated_at
         FROM credential_vault_entries WHERE status != 'active'`,
      )
      .all() as unknown as CredentialVaultRow[];
    return rows.map(mapMutation).filter((row): row is CredentialVaultMutation => row !== null);
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
      database.exec(`PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS credential_vault_entries (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('server', 'database')),
          environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'staging', 'production')),
          host TEXT NOT NULL,
          port INTEGER,
          username TEXT,
          workspace_identity TEXT,
          secret_key TEXT NOT NULL,
          previous_secret_key TEXT,
          status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'rotating', 'deleting')),
          operation_owner_pid INTEGER,
          operation_owner_started_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS credential_vault_entries_status_updated
          ON credential_vault_entries(status, updated_at DESC);
      `);
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
