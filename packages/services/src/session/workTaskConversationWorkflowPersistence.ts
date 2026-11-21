import {
  conversationWorkflowStateSchema,
  resolveWorkspaceKey,
  type ConversationWorkflowAttach,
  type ConversationWorkflowRecord,
  type ConversationWorkflowState,
  type ConversationWorkflowTransition,
} from "@zcode/shared";
import type { WorkTaskDatabase } from "./workTaskDatabase.js";
import { touchWorkTaskProject } from "./workTaskDatabase.js";
import { readWorkTaskWorkflow } from "./workTaskWorkflowPersistence.js";

type WorkflowRow = {
  workspace_path: string;
  workspace_identity: string | null;
  source_kind: "api" | "acp";
  session_id: string;
  revision: number;
  data: string;
};

function recordOf(row: WorkflowRow): ConversationWorkflowRecord {
  return {
    workspacePath: row.workspace_path,
    ...(row.workspace_identity ? { workspaceIdentity: row.workspace_identity } : {}),
    kind: row.source_kind,
    sessionId: row.session_id,
    state: conversationWorkflowStateSchema.parse(JSON.parse(row.data)),
  };
}

export function listConversationWorkflows(
  db: WorkTaskDatabase,
  scope: Pick<ConversationWorkflowAttach, "workspacePath" | "workspaceIdentity">,
): ConversationWorkflowRecord[] {
  const rows = db
    .prepare(
      "SELECT workspace_path,workspace_identity,source_kind,session_id,revision,data FROM work_task_conversation_workflows WHERE workspace_key=? AND workspace_path=? ORDER BY session_id",
    )
    .all(resolveWorkspaceKey(scope), scope.workspacePath) as WorkflowRow[];
  return rows
    .filter((row) => (row.workspace_identity ?? undefined) === scope.workspaceIdentity)
    .map(recordOf);
}

export function attachConversationWorkflow(
  db: WorkTaskDatabase,
  input: ConversationWorkflowAttach,
): ConversationWorkflowRecord {
  const workspaceKey = resolveWorkspaceKey(input);
  const existing = db
    .prepare(
      "SELECT workspace_path,workspace_identity,source_kind,session_id,revision,data FROM work_task_conversation_workflows WHERE workspace_key=? AND workspace_path=? AND source_kind=? AND session_id=?",
    )
    .get(workspaceKey, input.workspacePath, input.kind, input.sessionId) as WorkflowRow | undefined;
  if (existing) {
    if ((existing.workspace_identity ?? undefined) !== input.workspaceIdentity)
      throw new Error("work-task.conversation-workflow-source-mismatch");
    return recordOf(existing);
  }

  const definition = readWorkTaskWorkflow(db, input).workflow;
  if (!definition?.initialStageId)
    throw new Error("work-task.conversation-workflow-not-configured");
  const initial = definition.stages.find((stage) => stage.id === definition.initialStageId);
  if (!initial || initial.enabled === false)
    throw new Error("work-task.conversation-workflow-stage-invalid");
  const state = conversationWorkflowStateSchema.parse({
    definition,
    currentStageId: initial.id,
    owner: initial.owner,
    revision: 1,
    history: [],
  });
  db.prepare(
    "INSERT INTO work_task_conversation_workflows(workspace_key,workspace_path,workspace_identity,source_kind,session_id,revision,data) VALUES(?,?,?,?,?,?,?)",
  ).run(
    workspaceKey,
    input.workspacePath,
    input.workspaceIdentity ?? null,
    input.kind,
    input.sessionId,
    state.revision,
    JSON.stringify(state),
  );
  touchWorkTaskProject(db, workspaceKey);
  return { ...input, state };
}

export function transitionConversationWorkflow(
  db: WorkTaskDatabase,
  input: ConversationWorkflowTransition,
): ConversationWorkflowRecord {
  const workspaceKey = resolveWorkspaceKey(input);
  const row = db
    .prepare(
      "SELECT workspace_path,workspace_identity,source_kind,session_id,revision,data FROM work_task_conversation_workflows WHERE workspace_key=? AND workspace_path=? AND source_kind=? AND session_id=?",
    )
    .get(workspaceKey, input.workspacePath, input.kind, input.sessionId) as WorkflowRow | undefined;
  if (!row || (row.workspace_identity ?? undefined) !== input.workspaceIdentity)
    throw new Error("work-task.conversation-workflow-not-found");
  const state = conversationWorkflowStateSchema.parse(JSON.parse(row.data));
  const currentStage = state.definition.stages.find((stage) => stage.id === state.currentStageId);
  const targetStage = state.definition.stages.find((stage) => stage.id === input.targetStageId);
  if (
    state.revision !== input.expectedRevision ||
    state.currentStageId !== input.expectedStageId ||
    !currentStage ||
    !targetStage
  )
    throw new Error("work-task.conversation-workflow-stale");
  if (currentStage.id === targetStage.id || targetStage.enabled === false)
    throw new Error("work-task.conversation-workflow-transition-invalid");

  const next: ConversationWorkflowState = conversationWorkflowStateSchema.parse({
    ...state,
    currentStageId: targetStage.id,
    owner:
      targetStage.owner ??
      ((targetStage.handoff ?? "none") === "none"
        ? (state.owner ?? currentStage.owner)
        : undefined),
    revision: state.revision + 1,
    history: [
      ...state.history,
      {
        stageId: currentStage.id,
        stageName: currentStage.name,
        owner: state.owner ?? currentStage.owner,
        targetStageId: targetStage.id,
        handoffNote: input.handoffNote,
        transitionedAt: Date.now(),
      },
    ],
  });
  const result = db
    .prepare(
      "UPDATE work_task_conversation_workflows SET revision=?,data=? WHERE workspace_key=? AND workspace_path=? AND source_kind=? AND session_id=? AND revision=?",
    )
    .run(
      next.revision,
      JSON.stringify(next),
      workspaceKey,
      input.workspacePath,
      input.kind,
      input.sessionId,
      input.expectedRevision,
    );
  if (result.changes !== 1) throw new Error("work-task.conversation-workflow-stale");
  touchWorkTaskProject(db, workspaceKey);
  return {
    workspacePath: input.workspacePath,
    ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
    ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
    kind: input.kind,
    sessionId: input.sessionId,
    state: next,
  };
}
