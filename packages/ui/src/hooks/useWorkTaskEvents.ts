import { useEffect, useState } from "react";
import type { WorkTask, WorkTaskEvent } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";

export function useWorkTaskEvents(task: WorkTask) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    task.workspacePath,
    task.remoteSessionId,
    task.workspaceIdentity,
  );
  const [events, setEvents] = useState<WorkTaskEvent[]>([]);
  useEffect(() => {
    if (!services.workTaskService || !rpcReady) return;
    let active = true;
    void services.workTaskService
      .getEvents({
        workspacePath: task.workspacePath,
        workspaceIdentity: task.workspaceIdentity,
        remoteSessionId: task.remoteSessionId,
        id: task.id,
      })
      .then(
        (items) => {
          if (active) setEvents(items);
        },
        () => {
          if (active) setEvents([]);
        },
      );
    return () => {
      active = false;
    };
  }, [
    services.workTaskService,
    rpcReady,
    task.workspacePath,
    task.workspaceIdentity,
    task.remoteSessionId,
    task.id,
    task.updatedAt,
  ]);
  return events;
}
