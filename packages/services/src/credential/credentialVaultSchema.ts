import type { DatabaseSync } from "node:sqlite";

export function initializeCredentialVaultSchema(database: DatabaseSync): void {
  database.exec(`PRAGMA busy_timeout = 5000`);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS credential_vault_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'staging', 'production')),
      host TEXT NOT NULL,
      port INTEGER,
      username TEXT,
      scope TEXT NOT NULL CHECK (scope IN ('unassigned', 'global', 'project')),
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
  const columns = database.prepare("PRAGMA table_info(credential_vault_entries)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "scope")) {
    database.exec(`
      ALTER TABLE credential_vault_entries
      ADD COLUMN scope TEXT NOT NULL DEFAULT 'unassigned'
      CHECK (scope IN ('unassigned', 'global', 'project'));
      UPDATE credential_vault_entries
      SET scope = CASE WHEN workspace_identity IS NULL THEN 'unassigned' ELSE 'project' END;
    `);
  }

  const table = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credential_vault_entries'",
    )
    .get() as { sql: string } | undefined;
  if (table?.sql.includes("CHECK (kind IN ('server', 'database'))")) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE credential_vault_entries_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'staging', 'production')),
        host TEXT NOT NULL,
        port INTEGER,
        username TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('unassigned', 'global', 'project')),
        workspace_identity TEXT,
        secret_key TEXT NOT NULL,
        previous_secret_key TEXT,
        status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'rotating', 'deleting')),
        operation_owner_pid INTEGER,
        operation_owner_started_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO credential_vault_entries_new
      SELECT id, name, kind, environment, host, port, username, scope, workspace_identity,
             secret_key, previous_secret_key, status, operation_owner_pid,
             operation_owner_started_at, created_at, updated_at
      FROM credential_vault_entries;
      DROP TABLE credential_vault_entries;
      ALTER TABLE credential_vault_entries_new RENAME TO credential_vault_entries;
      CREATE INDEX credential_vault_entries_status_updated
        ON credential_vault_entries(status, updated_at DESC);
      COMMIT;
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS credential_vault_project_attachments (
      credential_id TEXT NOT NULL REFERENCES credential_vault_entries(id) ON DELETE CASCADE,
      workspace_identity TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, workspace_identity)
    );
    CREATE INDEX IF NOT EXISTS credential_vault_project_attachments_workspace
      ON credential_vault_project_attachments(workspace_identity, credential_id);
    INSERT OR IGNORE INTO credential_vault_project_attachments
      (credential_id, workspace_identity, created_at)
    SELECT id, workspace_identity, updated_at
    FROM credential_vault_entries
    WHERE scope = 'project' AND workspace_identity IS NOT NULL;
    UPDATE credential_vault_entries SET workspace_identity = NULL WHERE scope = 'project';
  `);
}
