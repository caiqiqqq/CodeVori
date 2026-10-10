import type { WorkTaskAttachmentImport, WorkTaskCreate } from "@zcode/shared";
import type { IWorkTaskService } from "./contract.js";

export async function archiveCompletedTaskAndRemoveWorktree(
  service: IWorkTaskService,
  workspacePath: string,
  id: string,
) {
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
