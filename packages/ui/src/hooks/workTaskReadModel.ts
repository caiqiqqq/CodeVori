import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskBoard, WorkTaskScope } from "@zcode/shared";
import { workTaskErrorMessage } from "../lib/workTaskBoard.js";
import { createSharedServiceRead } from "./sharedServiceRead.js";

type WorkTaskReadModel = ReturnType<typeof createSharedServiceRead<WorkTaskBoard>>;
const reads = new WeakMap<IWorkTaskService, Map<string, WorkTaskReadModel>>();

export function getWorkTaskReadModel(
  service: IWorkTaskService,
  input: WorkTaskScope,
  includeArchived: boolean,
): WorkTaskReadModel {
  const scope = {
    workspacePath: input.workspacePath,
    workspaceIdentity: input.workspaceIdentity?.trim() || undefined,
    remoteSessionId: input.remoteSessionId?.trim() || undefined,
  };
  const key = JSON.stringify([
    scope.workspaceIdentity || scope.workspacePath,
    scope.remoteSessionId || "",
    includeArchived,
  ]);
  let byScope = reads.get(service);
  if (!byScope) reads.set(service, (byScope = new Map()));
  let resource = byScope.get(key);
  if (!resource) {
    resource = createSharedServiceRead(
      () => service.list({ ...scope, includeArchived }),
      (changed) => service.onDynamicChanged(scope)(changed),
      workTaskErrorMessage,
    );
    byScope.set(key, resource);
  }
  return resource;
}
