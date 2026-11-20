import {
  uuidv7,
  resolveWorkspaceKey,
  workTaskWorkflowSchema,
  type WorkTaskScope,
  type WorkTaskWorkflowConfig,
  type WorkTaskWorkflowDefinition,
  type WorkTaskWorkflowDefinitionSave,
  type WorkTaskWorkflowDefinitionDelete,
  type WorkTaskWorkflowSave,
} from "@zcode/shared";
import { touchWorkTaskProject, type WorkTaskDatabase } from "./workTaskDatabase.js";

type DefinitionRow = { id: string; revision: number; data: string };
const touchCatalog = (db: WorkTaskDatabase) =>
  db.exec("UPDATE work_task_workflow_meta SET revision=revision+1 WHERE id=1");

/** 同一个 Host 数据库拥有定义和项目引用；项目不再复制另一份可修改定义。 */
export function initializeWorkTaskWorkflowLibrary(db: WorkTaskDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS work_task_workflow_catalog(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_task_workflow_meta(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO work_task_workflow_meta(id, revision) VALUES(1,0);
    BEGIN IMMEDIATE;`);
  try {
    const columns = db.prepare("PRAGMA table_info(work_task_workflows)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "workflow_id"))
      db.exec("ALTER TABLE work_task_workflows ADD COLUMN workflow_id TEXT");
    // 兼容本分支此前的项目内定义：迁移成目录项和引用，保留已创建任务自己的快照。
    const old = db
      .prepare(
        "SELECT workspace_key, data FROM work_task_workflows WHERE data IS NOT NULL AND workflow_id IS NULL",
      )
      .all() as { workspace_key: string; data: string }[];
    for (const row of old) {
      let workflow = workTaskWorkflowSchema.parse(JSON.parse(row.data));
      const existing = db
        .prepare("SELECT data FROM work_task_workflow_catalog WHERE id=?")
        .get(workflow.id) as { data: string } | undefined;
      // 旧版按项目保存，同一 ID 也可能被独立编辑；冲突时保留两份定义，不能丢掉某个项目的配置。
      if (
        existing &&
        JSON.stringify(workTaskWorkflowSchema.parse(JSON.parse(existing.data))) !==
          JSON.stringify(workflow)
      )
        workflow = { ...workflow, id: uuidv7() };
      db.prepare(
        "INSERT OR IGNORE INTO work_task_workflow_catalog(id,revision,data) VALUES(?,1,?)",
      ).run(workflow.id, JSON.stringify(workflow));
      db.prepare(
        "UPDATE work_task_workflows SET workflow_id=?,data=NULL WHERE workspace_key=?",
      ).run(workflow.id, row.workspace_key);
    }
    if (old.length) touchCatalog(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function workTaskWorkflowCatalogRevision(db: WorkTaskDatabase): number {
  return (
    db.prepare("SELECT revision FROM work_task_workflow_meta WHERE id=1").get() as {
      revision: number;
    }
  ).revision;
}
export function listWorkTaskWorkflows(db: WorkTaskDatabase): WorkTaskWorkflowDefinition[] {
  const rows = db
    .prepare("SELECT id,revision,data FROM work_task_workflow_catalog ORDER BY rowid")
    .all() as DefinitionRow[];
  return rows.map((row) => ({
    workflow: workTaskWorkflowSchema.parse(JSON.parse(row.data)),
    revision: row.revision,
    projectKeys: (
      db
        .prepare(
          "SELECT workspace_key FROM work_task_workflows WHERE workflow_id=? ORDER BY workspace_key",
        )
        .all(row.id) as { workspace_key: string }[]
    ).map((row) => row.workspace_key),
  }));
}
export function readWorkTaskWorkflow(
  db: WorkTaskDatabase,
  scope: WorkTaskScope,
): WorkTaskWorkflowConfig {
  const row = db
    .prepare(
      `SELECT p.revision,c.data FROM work_task_workflows p LEFT JOIN work_task_workflow_catalog c ON c.id=p.workflow_id WHERE p.workspace_key=?`,
    )
    .get(resolveWorkspaceKey(scope)) as { revision: number; data: string | null } | undefined;
  return {
    workflow: row?.data ? workTaskWorkflowSchema.parse(JSON.parse(row.data)) : null,
    revision: row?.revision ?? 0,
  };
}
/** All writes below execute inside WorkTaskRepo's BEGIN IMMEDIATE boundary. */
export function saveWorkTaskWorkflowDefinition(
  db: WorkTaskDatabase,
  input: WorkTaskWorkflowDefinitionSave,
): WorkTaskWorkflowDefinition {
  const workflow = workTaskWorkflowSchema.parse(input.workflow);
  const row = db
    .prepare("SELECT revision FROM work_task_workflow_catalog WHERE id=?")
    .get(workflow.id) as { revision: number } | undefined;
  if ((row?.revision ?? 0) !== input.expectedRevision) throw new Error("work-task.workflow-stale");
  db.prepare(
    `INSERT INTO work_task_workflow_catalog(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data`,
  ).run(workflow.id, input.expectedRevision + 1, JSON.stringify(workflow));
  const projects = db
    .prepare("SELECT workspace_key FROM work_task_workflows WHERE workflow_id=?")
    .all(workflow.id) as { workspace_key: string }[];
  db.prepare("UPDATE work_task_workflows SET revision=revision+1 WHERE workflow_id=?").run(
    workflow.id,
  );
  for (const project of projects) touchWorkTaskProject(db, project.workspace_key);
  touchCatalog(db);
  return {
    workflow,
    revision: input.expectedRevision + 1,
    projectKeys: projects.map((row) => row.workspace_key),
  };
}
export function selectWorkTaskWorkflow(
  db: WorkTaskDatabase,
  input: WorkTaskWorkflowSave,
): WorkTaskWorkflowConfig {
  if (readWorkTaskWorkflow(db, input).revision !== input.expectedRevision)
    throw new Error("work-task.workflow-stale");
  if (
    input.workflowId &&
    !db.prepare("SELECT id FROM work_task_workflow_catalog WHERE id=?").get(input.workflowId)
  )
    throw new Error("work-task.workflow-not-found");
  const key = resolveWorkspaceKey(input);
  db.prepare(
    `INSERT INTO work_task_workflows(workspace_key,revision,data,workflow_id) VALUES(?,?,NULL,?) ON CONFLICT(workspace_key) DO UPDATE SET revision=excluded.revision,data=NULL,workflow_id=excluded.workflow_id`,
  ).run(key, input.expectedRevision + 1, input.workflowId);
  touchWorkTaskProject(db, key);
  touchCatalog(db);
  return readWorkTaskWorkflow(db, input);
}
export function deleteWorkTaskWorkflowDefinition(
  db: WorkTaskDatabase,
  input: WorkTaskWorkflowDefinitionDelete,
) {
  const row = db
    .prepare("SELECT revision FROM work_task_workflow_catalog WHERE id=?")
    .get(input.id) as { revision: number } | undefined;
  if (row?.revision !== input.expectedRevision) throw new Error("work-task.workflow-stale");
  if (
    db
      .prepare("SELECT workspace_key FROM work_task_workflows WHERE workflow_id=? LIMIT 1")
      .get(input.id)
  )
    throw new Error("work-task.workflow-in-use");
  db.prepare("DELETE FROM work_task_workflow_catalog WHERE id=?").run(input.id);
  touchCatalog(db);
}
