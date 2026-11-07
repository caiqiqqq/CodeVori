import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateLegacyDesktopData } from "../src/main/desktopLegacyDataMigration.ts";

for (const version of [1, 2]) {
  test(`repairs ordinary history and ACP workspace ownership after completed v${version} migration`, async () => {
    const root = await mkdtemp(join(tmpdir(), "codevori-history-repair-"));
    const source = join(root, ".zcode");
    const target = join(root, ".codevori");
    const oldWorkspace = join(source, "workspace", "default");
    const newWorkspace = join(target, "workspace", "default");
    try {
      for (const base of [source, target]) {
        for (const dir of ["v2", "cli/db", "acp-sessions"])
          await mkdir(join(base, dir), { recursive: true });
      }
      await mkdir(join(root, "CodeVori"));
      await writeFile(
        join(target, ".migration-from-zcode.json"),
        JSON.stringify({ version, status: "complete" }),
      );
      const legacy = new DatabaseSync(join(source, "cli/db/db.sqlite"));
      legacy.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,path TEXT,time_deleted INTEGER);
        CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT REFERENCES session(id),data TEXT);
        CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT REFERENCES message(id),data TEXT);
        CREATE TABLE schema_migration(id TEXT PRIMARY KEY);`);
      legacy.prepare("INSERT INTO session VALUES('old',?,?,NULL)").run(oldWorkspace, oldWorkspace);
      legacy
        .prepare("INSERT INTO message VALUES('message','old',?)")
        .run(JSON.stringify({ workspacePath: oldWorkspace, text: "keep tool input" }));
      legacy.exec(
        "INSERT INTO part VALUES('part','message','{}');INSERT INTO schema_migration VALUES('future-schema')",
      );
      legacy.close();
      const product = new DatabaseSync(join(target, "cli/db/db.sqlite"));
      product.exec(
        "CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,path TEXT);INSERT INTO session VALUES('new','/project','/project');CREATE TABLE schema_migration(id TEXT PRIMARY KEY);INSERT INTO schema_migration VALUES('current-schema')",
      );
      product.close();
      const index = new DatabaseSync(join(source, "v2/tasks-index.sqlite"));
      index.exec(
        "CREATE TABLE tasks(workspace_key TEXT,task_id TEXT,workspace_path TEXT,meta_json TEXT,archived INTEGER,root_path TEXT,PRIMARY KEY(workspace_key,task_id))",
      );
      index
        .prepare("INSERT INTO tasks VALUES(?,'old',?,?,1,?)")
        .run(
          oldWorkspace,
          oldWorkspace,
          JSON.stringify({ workspacePath: oldWorkspace }),
          oldWorkspace,
        );
      index.close();
      new DatabaseSync(join(target, "v2/tasks-index.sqlite")).close();
      const checkpoint = {
        id: "acp",
        workspacePath: oldWorkspace,
        title: "current title",
        revision: 1,
        entries: [{ text: oldWorkspace }],
      };
      const journal = {
        version: 1,
        previousRevision: 1,
        metadata: { id: "acp", workspacePath: oldWorkspace, revision: 2 },
        changes: [[0, { text: oldWorkspace }]],
        length: 1,
      };
      for (const base of [source, target]) {
        await writeFile(join(base, "acp-sessions/acp.json"), JSON.stringify(checkpoint));
        await writeFile(
          join(base, "acp-sessions/acp.json.journal"),
          JSON.stringify(journal) + "\n",
        );
        await writeFile(join(base, "acp-sessions/acp.json.summary"), "stale");
      }
      const options = {
        legacyDataRoots: [{ source, target }],
        legacyProfile: join(root, "ZCode"),
        productProfile: join(root, "CodeVori"),
        isLegacyRunning: async () => false,
      };
      assert.equal(await migrateLegacyDesktopData(options), "migrated");
      const restored = new DatabaseSync(join(target, "cli/db/db.sqlite"));
      assert.equal(restored.prepare("SELECT count(*) AS n FROM session").get()?.n, 2);
      assert.equal(
        restored.prepare("SELECT directory FROM session WHERE id='old'").get()?.directory,
        newWorkspace,
      );
      assert.equal(restored.prepare("SELECT count(*) AS n FROM part").get()?.n, 1);
      assert.equal(
        JSON.parse(String(restored.prepare("SELECT data FROM message").get()?.data)).workspacePath,
        oldWorkspace,
        "chat and tool input must stay verbatim",
      );
      assert.equal(restored.prepare("SELECT id FROM schema_migration").get()?.id, "current-schema");
      assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
      restored.close();
      const restoredIndex = new DatabaseSync(join(target, "v2/tasks-index.sqlite"));
      const row = restoredIndex.prepare("SELECT * FROM tasks").get()!;
      assert.equal(row.workspace_key, newWorkspace);
      assert.equal(row.archived, 1);
      assert.equal(row.root_path, newWorkspace);
      restoredIndex.close();
      const moved = JSON.parse(await readFile(join(target, "acp-sessions/acp.json"), "utf8"));
      assert.equal(moved.workspacePath, newWorkspace);
      assert.deepEqual(moved.entries, checkpoint.entries);
      assert.equal(moved.title, "current title");
      const movedJournal = JSON.parse(
        await readFile(join(target, "acp-sessions/acp.json.journal"), "utf8"),
      );
      assert.equal(movedJournal.metadata.workspacePath, newWorkspace);
      assert.deepEqual(movedJournal.changes, journal.changes);
      assert.ok(!(await readdir(join(target, "acp-sessions"))).includes("acp.json.summary"));
      assert.equal(
        JSON.parse(await readFile(join(source, "acp-sessions/acp.json"), "utf8")).workspacePath,
        oldWorkspace,
      );
      assert.equal(
        JSON.parse(await readFile(join(target, ".migration-from-zcode.json"), "utf8")).version,
        3,
      );
      assert.equal(await migrateLegacyDesktopData(options), "already-current");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
