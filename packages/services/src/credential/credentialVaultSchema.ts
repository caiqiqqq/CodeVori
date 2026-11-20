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
      kind TEXT NOT NULL CHECK (kind IN ('server', 'database')),
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
  if (columns.some((column) => column.name === "scope")) return;
  database.exec(`
    ALTER TABLE credential_vault_entries
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (scope IN ('unassigned', 'global', 'project'));
    UPDATE credential_vault_entries
    SET scope = CASE WHEN workspace_identity IS NULL THEN 'unassigned' ELSE 'project' END;
  `);
}
