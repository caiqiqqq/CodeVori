import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskWorkflow, WorkTaskWorkflowDefinition } from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { createSharedServiceRead } from "./sharedServiceRead.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";

const resources = new WeakMap<
  IWorkTaskService,
  ReturnType<typeof createSharedServiceRead<WorkTaskWorkflowDefinition[]>>
>();
const unavailableResource = createSharedServiceRead<WorkTaskWorkflowDefinition[]>(
  async () => {
    throw new Error("work-task.execution-unsupported");
  },
  undefined,
  workTaskErrorMessage,
);
function getResource(service: IWorkTaskService | undefined) {
  if (!service) return unavailableResource;
  let resource = resources.get(service);
  if (!resource) {
    resource = createSharedServiceRead(
      () => service.listWorkflows(),
      (listener) => service.onDynamicWorkflowsChanged()(listener),
      workTaskErrorMessage,
    );
    resources.set(service, resource);
  }
  return resource;
}
/** 设置页和项目选择器只共享 Host 目录的读投影；保存仍只有 Service 命令路径。 */
export function useTaskWorkflows() {
  const { workTaskService: service } = useBaseWorkspaceServices();
  const resource = useMemo(() => getResource(service), [service]);
  const read = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const owner = useRef(resource);
  owner.current = resource;
  const flight = useRef(false);
  const [mutation, setMutation] = useState<{
    resource: typeof resource;
    busy: boolean;
    error: string | null;
  }>({ resource, busy: false, error: null });
  const run = async (action: () => Promise<unknown>) => {
    if (flight.current) return false;
    flight.current = true;
    const version = resource.getEventVersion();
    setMutation({ resource, busy: true, error: null });
    try {
      await action();
      resource.refreshAfterMutation(version);
      if (owner.current !== resource) return false;
      setMutation({ resource, busy: false, error: null });
      return true;
    } catch (error) {
      if (owner.current === resource)
        setMutation({ resource, busy: false, error: workTaskErrorMessage(error) });
      return false;
    } finally {
      flight.current = false;
    }
  };
  return {
    definitions: read.data ?? [],
    loading: read.loading,
    error: mutation.resource === resource && mutation.error ? mutation.error : read.error,
    busy: mutation.resource === resource && mutation.busy,
    refresh: () => resource.refresh(true),
    save: (workflow: WorkTaskWorkflow, expectedRevision: number) =>
      run(async () => {
        if (!service) throw new Error("work-task.execution-unsupported");
        return service.saveWorkflowDefinition({ workflow, expectedRevision });
      }),
    remove: (id: string, expectedRevision: number) =>
      run(async () => {
        if (!service) throw new Error("work-task.execution-unsupported");
        return service.deleteWorkflowDefinition({ id, expectedRevision });
      }),
  };
}
