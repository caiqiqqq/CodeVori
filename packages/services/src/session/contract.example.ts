import type {
  WorkTaskAttachmentImport,
  WorkTaskCreate,
  WorkTaskResultRequest,
  WorkTaskRename,
  WorkTaskWorkflowSave,
  WorkTaskWorkflowDefinitionSave,
  WorkTaskWorkflowTransition,
  ConversationWorkflowAttach,
  ConversationWorkflowTransition,
  RepositoryIssueProject,
} from "@zcode/shared";
import type { IWorkTaskService } from "./contract.js";

/** 队列与名额由 Host 调度，不在调用方先截取任务或维护等待队列。 */
export async function enqueueProjectTasks(service: IWorkTaskService, workspacePath: string) {
  return service.startAll({ workspacePath });
}

export async function renameWorkTask(service: IWorkTaskService, request: WorkTaskRename) {
  return service.rename(request);
}

export async function saveReusableWorkflow(
  service: IWorkTaskService,
  request: WorkTaskWorkflowDefinitionSave,
) {
  return service.saveWorkflowDefinition(request);
}

export async function saveProjectWorkflow(
  service: IWorkTaskService,
  request: WorkTaskWorkflowSave,
) {
  return service.saveWorkflow(request);
}

export async function transitionTaskStage(
  service: IWorkTaskService,
  request: WorkTaskWorkflowTransition,
) {
  return service.transitionWorkflow(request);
}

export async function adoptConversationWorkflow(
  service: IWorkTaskService,
  request: ConversationWorkflowAttach,
) {
  return service.attachConversationWorkflow(request);
}

export async function transitionConversationStage(
  service: IWorkTaskService,
  request: ConversationWorkflowTransition,
) {
  // 普通会话只更新业务阶段，不会向 API/ACP 会话提交新输入。
  return service.transitionConversationWorkflow(request);
}

export async function readUnhandledRepositoryIssues(
  service: IWorkTaskService,
  projects: RepositoryIssueProject[],
) {
  return service.getRepositoryIssueSummary({ projects });
}

export async function generateEditableResult(
  service: IWorkTaskService,
  request: WorkTaskResultRequest,
) {
  // 生成是只读摘要；由调用者保存草稿，另行确认 complete/merge。
  return service.generateResult(request);
}

export async function readResultGenerationSource(
  service: IWorkTaskService,
  request: WorkTaskResultRequest,
) {
  return service.getResultSource({
    workspacePath: request.workspacePath,
    id: request.id,
    runSeq: request.runSeq,
  });
}

export async function archiveCompletedTaskAndRemoveWorktree(
  service: IWorkTaskService,
  workspacePath: string,
  id: string,
) {
  // 返回的是持久化受理；调用方用 list/onDynamicChanged 读取归档或失败结果。
  return service.archive({ workspacePath, id, archived: true, removeWorktree: true });
}

export async function saveWorkTaskDraft(service: IWorkTaskService, draft: WorkTaskCreate) {
  const task = await service.create(draft);
  return service.list({
    workspacePath: task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
  });
}

export async function saveDirectBranchTask(
  service: IWorkTaskService,
  draft: WorkTaskCreate,
  sourceBranch: string,
) {
  return service.create({ ...draft, useWorktree: false, sourceBranch });
}

export async function saveAttachedWorkTaskDraft(
  service: IWorkTaskService,
  draft: WorkTaskCreate,
  file: WorkTaskAttachmentImport,
) {
  const attachment = await service.attachmentImport(file);
  return service.create({ ...draft, attachments: [...(draft.attachments ?? []), attachment] });
}

export async function mergeReviewedWorkTask(
  service: IWorkTaskService,
  draft: WorkTaskCreate,
  id: string,
  targetBranch: string,
) {
  return service.merge({
    workspacePath: draft.workspacePath,
    workspaceIdentity: draft.workspaceIdentity,
    remoteSessionId: draft.remoteSessionId,
    id,
    targetBranch,
  });
}

export async function acceptLinkedIssue(
  service: IWorkTaskService,
  draft: WorkTaskCreate,
  id: string,
) {
  return service.complete({
    workspacePath: draft.workspacePath,
    workspaceIdentity: draft.workspaceIdentity,
    remoteSessionId: draft.remoteSessionId,
    id,
    forge: { closeIssue: true, comment: "Verified result." },
  });
}
