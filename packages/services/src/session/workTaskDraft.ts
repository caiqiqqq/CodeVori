import {
  resolveWorkspaceKey,
  uuidv7,
  workTaskSchema,
  type WorkTask,
  type WorkTaskCreate,
} from "@zcode/shared";
import { recordWorkTaskChange, type WorkTaskDatabase } from "./workTaskDatabase.js";
import { assertWorkTaskWorkspaceEditable } from "./workTaskConversationState.js";
import { assertWorkTaskSourceAvailable } from "./workTaskForgeState.js";

/** Runs inside the task owner's existing immediate transaction. */
export function createWorkTaskDraft(
  db: WorkTaskDatabase,
  input: WorkTaskCreate,
  tasks: WorkTask[],
): WorkTask {
  assertWorkTaskWorkspaceEditable(null, input);
  assertWorkTaskSourceAvailable(tasks, input.source);
  const now = Date.now();
  const task: WorkTask = {
    ...input,
    id: uuidv7(),
    sessionRequestId: uuidv7(),
    commandId: uuidv7(),
    status: "todo",
    archived: false,
    runSeq: 0,
    runText: input.prompt,
    runUsesPromptAssets: true,
    stopPending: false,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare("INSERT INTO work_tasks(id,workspace_key,status,data) VALUES(?,?,?,?)").run(
    task.id,
    resolveWorkspaceKey(task),
    task.status,
    JSON.stringify(workTaskSchema.parse(task)),
  );
  recordWorkTaskChange(db, task, "created");
  return task;
}
