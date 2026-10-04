import type { WorkTaskCreate } from "@zcode/shared";
import type { IWorkTaskService } from "./contract.js";

export async function saveWorkTaskDraft(service: IWorkTaskService, draft: WorkTaskCreate) {
  const task = await service.create(draft);
  return service.list({
    workspacePath: task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
  });
}
