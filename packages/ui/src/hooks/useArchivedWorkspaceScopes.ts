import { useEffect, useMemo, useState } from "react";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { logger } from "@/logger.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export type ArchiveWorkspaceScope = Pick<
  WorkspaceTabState,
  "workspacePath" | "workspaceIdentity" | "remoteSessionId" | "remoteTarget" | "label"
>;

/** Archive scope discovery is a read projection; closing a tab never deletes its history. */
export function useArchivedWorkspaceScopes(tabs: WorkspaceTabState[]): ArchiveWorkspaceScope[] {
  const services = useBaseWorkspaceServices();
  const tabSignature = JSON.stringify(
    tabs
      .map((tab) => [tab.workspaceIdentity?.trim() || tab.workspacePath, tab.workspacePath])
      .sort(),
  );
  const [known, setKnown] = useState<ArchiveWorkspaceScope[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      services.zcodeTaskService.listArchivedWorkspaces(),
      services.acpService.listArchivedWorkspaces(),
    ]).then((results) => {
      if (!live) return;
      const scopes: ArchiveWorkspaceScope[] = [];
      for (const result of results) {
        if (result.status === "fulfilled")
          scopes.push(...result.value.map((scope) => ({ ...scope, label: "" })));
        else logger.warn("[archive] 读取归档工作区失败", { error: result.reason });
      }
      setKnown(scopes);
    });
    return () => {
      live = false;
    };
  }, [services, tabSignature]);
  return useMemo(() => {
    const scopes = new Map<string, ArchiveWorkspaceScope>();
    for (const scope of [...known, ...tabs])
      scopes.set(buildTaskWorkspaceKey(scope.workspacePath, scope.workspaceIdentity), scope);
    return [...scopes.values()];
  }, [known, tabs]);
}
