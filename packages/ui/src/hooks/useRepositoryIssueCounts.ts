import { useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { IWorkTaskService } from "@zcode/services";
import type { RepositoryIssueProject } from "@zcode/shared";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useRemoteWorkspaceSessionStore } from "../store/remoteWorkspaceSessionStore.js";
import { repositoryNavigationStore } from "../store/repositoryNavigationStore.js";
import { resolveWorkspaceServices } from "../lib/workspaceServiceResolver.js";
import { workTaskSidebarScopes } from "../lib/workTaskSidebarCounts.js";
import {
  getRepositoryIssueReadModel,
  combineRepositoryIssueReads,
  type RepositoryIssueReadSource,
} from "./repositoryIssueReadModel.js";

export function useRepositoryIssueCounts(projects: Parameters<typeof workTaskSidebarScopes>[0]) {
  const baseServices = useBaseWorkspaceServices();
  const sessionsById = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const sessionIdByWorkspaceIdentity = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspaceIdentity,
  );
  const sessionIdByWorkspacePath = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspacePath,
  );
  const remotes = useStore(repositoryNavigationStore, (state) => state.remotes);
  const scopes = useMemo(() => workTaskSidebarScopes(projects), [projects]);
  const combined = useMemo(() => {
    const batches = new Map<IWorkTaskService, RepositoryIssueProject[]>();
    const sources: RepositoryIssueReadSource[] = [];
    for (const { scope } of scopes) {
      const resolved = resolveWorkspaceServices(scope, baseServices, {
        sessionsById,
        sessionIdByWorkspaceIdentity,
        sessionIdByWorkspacePath,
      });
      const service = resolved?.services.workTaskService;
      if (!service) {
        sources.push({ resource: null, error: resolved ? "UNSUPPORTED" : "DISCONNECTED" });
        continue;
      }
      const batch = batches.get(service) ?? [];
      batch.push({
        ...scope,
        remoteSessionId: resolved?.remoteSessionId ?? scope.remoteSessionId,
        remoteName: remotes[scope.workspaceIdentity?.trim() || scope.workspacePath],
      });
      batches.set(service, batch);
    }
    for (const [service, batch] of batches)
      sources.push({ resource: getRepositoryIssueReadModel(service, batch), error: null });
    return combineRepositoryIssueReads(sources);
  }, [
    baseServices,
    sessionsById,
    sessionIdByWorkspaceIdentity,
    sessionIdByWorkspacePath,
    scopes,
    remotes,
  ]);
  return useSyncExternalStore(combined.subscribe, combined.getSnapshot, combined.getSnapshot);
}
