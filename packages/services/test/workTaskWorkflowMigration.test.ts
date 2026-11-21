import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { scope, definition, fixture } from "./workTaskWorkflowFixture.js";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

test("project definitions migrate atomically to reusable references without losing independently edited copies", async () => {
  const f = await fixture();
  let migrated: WorkTaskRepo | undefined;
  try {
    f.repo.close();
    const db = new DatabaseSync(f.path);
    const workflow = definition();
    try {
      db.exec(
        "DROP TABLE work_task_workflows; CREATE TABLE work_task_workflows(workspace_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT)",
      );
      const insert = db.prepare(
        "INSERT INTO work_task_workflows(workspace_key,revision,data) VALUES(?,?,?)",
      );
      insert.run(scope.workspacePath, 3, JSON.stringify(workflow));
      insert.run(
        "/independently-edited",
        5,
        JSON.stringify({ ...workflow, name: "Independent copy" }),
      );
    } finally {
      db.close();
    }
    migrated = new WorkTaskRepo(f.path);
    await migrated.ready();
    assert.deepEqual(migrated.workflow(scope), { workflow, revision: 3 });
    const other = migrated.workflow({ workspacePath: "/independently-edited" });
    assert.equal(other.workflow?.name, "Independent copy");
    assert.notEqual(other.workflow?.id, workflow.id);
    assert.equal(other.revision, 5);
    assert.equal(migrated.listWorkflows().length, 2);
    assert.equal(migrated.claimNext("owner", Date.now(), 30000), null);
    migrated.close();
    migrated = new WorkTaskRepo(f.path);
    await migrated.ready();
    assert.equal(migrated.listWorkflows().length, 2, "restart migration is idempotent");
  } finally {
    migrated?.close();
    await f.cleanup();
  }
});
