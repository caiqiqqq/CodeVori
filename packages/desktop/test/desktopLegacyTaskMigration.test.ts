import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateLegacyDesktopData } from "../src/main/desktopLegacyDataMigration.ts";
import { migrateLegacyTaskDatabases } from "../src/main/desktopLegacyTaskMigration.ts";

function tasks(file: string, workspace: string, id: string, title: string) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE work_tasks(id TEXT PRIMARY KEY, workspace_key TEXT, data TEXT);
    CREATE TABLE work_task_projects(workspace_key TEXT PRIMARY KEY, concurrency INTEGER);
    CREATE TABLE work_task_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, message TEXT);`);
  db.prepare("INSERT INTO work_tasks VALUES(?,?,?)").run(
    id,
    workspace,
    JSON.stringify({ workspacePath: workspace, title }),
  );
  db.prepare("INSERT INTO work_task_projects VALUES(?,?)").run(workspace, 2);
  db.prepare("INSERT INTO work_task_events(task_id,message) VALUES(?,?)").run(id, title);
  return db;
}

for (const completedV1 of [false, true]) {
  test(`repairs task and delegation databases with existing product records (completed v1: ${completedV1})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "codevori-task-repair-"));
    const source = join(root, ".zcode");
    const target = join(root, ".codevori");
    const oldWorkspace = join(source, "workspace", "default");
    const newWorkspace = join(target, "workspace", "default");
    const options = {
      legacyDataRoots: [{ source, target }],
      legacyProfile: join(root, "ZCode"),
      productProfile: join(root, "CodeVori"),
      isLegacyRunning: async () => false,
    };
    try {
      await mkdir(source);
      await mkdir(target);
      if (completedV1) {
        await mkdir(options.productProfile);
        await writeFile(
          join(target, ".migration-from-zcode.json"),
          '{"version":1,"status":"complete"}',
        );
      }
      const legacy = tasks(join(source, "work-tasks.sqlite"), oldWorkspace, "old-task", "legacy");
      legacy
        .prepare("INSERT INTO work_tasks VALUES(?,?,?)")
        .run("existing", oldWorkspace, '{"title":"obsolete"}');
      legacy.close();
      const product = tasks(join(target, "work-tasks.sqlite"), newWorkspace, "existing", "product");
      product.close();
      const delegated = new DatabaseSync(join(source, "agent-delegations.sqlite"));
      delegated.exec(`CREATE TABLE delegations(id TEXT PRIMARY KEY, parent_key TEXT, data TEXT);
        CREATE TABLE delegation_parents(key TEXT PRIMARY KEY, generation INTEGER, suspended INTEGER);
        CREATE TABLE delegation_child_sessions(workspace_key TEXT, workspace_path TEXT, kind TEXT, session_id TEXT, task_id TEXT,
          PRIMARY KEY(workspace_key,workspace_path,kind,session_id));`);
      const parent = JSON.stringify([oldWorkspace, "acp", "parent"]);
      delegated
        .prepare("INSERT INTO delegations VALUES(?,?,?)")
        .run(
          "child",
          parent,
          JSON.stringify({ parent: { workspacePath: oldWorkspace }, task: oldWorkspace }),
        );
      delegated.prepare("INSERT INTO delegation_parents VALUES(?,3,1)").run(parent);
      delegated
        .prepare("INSERT INTO delegation_child_sessions VALUES(?,?,'acp','child-session','child')")
        .run(oldWorkspace, oldWorkspace);
      delegated.close();
      // 空库也是有效 SQLite 文件，不能依赖文件是否存在判断任务是否已经迁移。
      new DatabaseSync(join(target, "agent-delegations.sqlite")).close();

      assert.equal(await migrateLegacyDesktopData(options), "migrated");
      const restored = new DatabaseSync(join(target, "work-tasks.sqlite"));
      try {
        assert.equal(restored.prepare("SELECT count(*) AS n FROM work_tasks").get()?.n, 2);
        assert.deepEqual(
          JSON.parse(
            String(restored.prepare("SELECT data FROM work_tasks WHERE id='existing'").get()?.data),
          ),
          { workspacePath: newWorkspace, title: "product" },
        );
        assert.deepEqual(
          JSON.parse(
            String(restored.prepare("SELECT data FROM work_tasks WHERE id='old-task'").get()?.data),
          ),
          { workspacePath: newWorkspace, title: "legacy" },
        );
        assert.equal(
          restored.prepare("SELECT workspace_key FROM work_tasks WHERE id='old-task'").get()
            ?.workspace_key,
          newWorkspace,
        );
        assert.deepEqual(
          restored
            .prepare("SELECT task_id FROM work_task_events ORDER BY sequence")
            .all()
            .map((row) => row.task_id),
          ["existing", "old-task"],
        );
      } finally {
        restored.close();
      }
      const children = new DatabaseSync(join(target, "agent-delegations.sqlite"));
      try {
        assert.equal(
          children.prepare("SELECT parent_key FROM delegations").get()?.parent_key,
          JSON.stringify([newWorkspace, "acp", "parent"]),
        );
        const data = JSON.parse(
          String(children.prepare("SELECT data FROM delegations").get()?.data),
        );
        assert.equal(data.parent.workspacePath, newWorkspace);
        assert.equal(data.task, oldWorkspace, "user text must remain verbatim");
        assert.equal(
          children.prepare("SELECT workspace_path FROM delegation_child_sessions").get()
            ?.workspace_path,
          newWorkspace,
        );
        assert.equal(
          children.prepare("SELECT suspended FROM delegation_parents").get()?.suspended,
          1,
        );
      } finally {
        children.close();
      }
      assert.equal((await readdir(join(target, ".legacy-task-backups"))).length, 2);
      assert.equal(
        JSON.parse(await readFile(join(target, ".migration-from-zcode.json"), "utf8")).version,
        3,
      );
      assert.equal(await migrateLegacyDesktopData(options), "already-current");
      await migrateLegacyTaskDatabases(source, target);
      const repeated = new DatabaseSync(join(target, "work-tasks.sqlite"));
      assert.equal(repeated.prepare("SELECT count(*) AS n FROM work_task_events").get()?.n, 2);
      repeated.close();
      const unchanged = new DatabaseSync(join(source, "work-tasks.sqlite"), { readOnly: true });
      assert.equal(
        unchanged.prepare("SELECT workspace_key FROM work_tasks WHERE id='old-task'").get()
          ?.workspace_key,
        oldWorkspace,
      );
      unchanged.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("invalid legacy data rolls back a database import and preserves the v1 retry marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-task-rollback-"));
  try {
    const source = join(root, "old");
    const target = join(root, "new");
    await mkdir(source);
    await mkdir(target);
    const legacy = tasks(join(source, "work-tasks.sqlite"), source, "old-task", "legacy");
    legacy.prepare("INSERT INTO work_tasks VALUES('bad',?,'invalid json')").run(source);
    legacy.close();
    tasks(join(target, "work-tasks.sqlite"), target, "existing", "product").close();
    await writeFile(
      join(target, ".migration-from-zcode.json"),
      '{"version":1,"status":"complete"}',
    );
    await assert.rejects(
      migrateLegacyDesktopData({
        legacyDataRoots: [{ source, target }],
        legacyProfile: join(root, "ZCode"),
        productProfile: join(root, "CodeVori"),
        isLegacyRunning: async () => false,
      }),
    );
    const db = new DatabaseSync(join(target, "work-tasks.sqlite"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM work_tasks").get()?.n, 1);
    db.close();
    assert.equal(
      JSON.parse(await readFile(join(target, ".migration-from-zcode.json"), "utf8")).version,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
