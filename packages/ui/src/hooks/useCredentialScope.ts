import { useMemo, useState } from "react";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useWorktreeProjectGroupsResolution } from "./useWorktreeProjectGroups.js";

export interface CredentialScopeProject extends Pick<
  WorkspaceTabState,
  "workspacePath" | "workspaceIdentity" | "remoteSessionId" | "remoteTarget"
> {
  identity: string;
  label: string;
}

type Scope = { kind: "global" } | { kind: "project"; identity: string };

export function useCredentialScope({
  projects,
  initialWorkspacePath,
  initialWorkspaceIdentity,
}: {
  projects: Array<Omit<CredentialScopeProject, "identity">>;
  initialWorkspacePath: string | null;
  initialWorkspaceIdentity?: string | null;
}) {
  const tabs = useMemo(() => {
    const unique = new Map<string, CredentialScopeProject & WorkspaceTabState>();
    for (const project of projects) {
      const identity = project.workspaceIdentity?.trim() || project.workspacePath.trim();
      if (!identity) continue;
      unique.set(identity, {
        ...project,
        identity,
        id: identity,
        kind: "workspace",
        workspaceIdentity: project.workspaceIdentity?.trim() || undefined,
      });
    }
    return [...unique.values()];
  }, [projects]);
  const { resolvedGroups, loading } = useWorktreeProjectGroupsResolution(tabs);
  const mainGroups = useMemo(
    () => resolvedGroups.filter((group) => !group.isLinkedWorktree),
    [resolvedGroups],
  );
  const visibleProjects = useMemo(
    () => mainGroups.map(({ tab }) => tabs.find((project) => project.id === tab.id)!),
    [mainGroups, tabs],
  );
  const [requestedScope, setSelectedScope] = useState<Scope>(() => {
    const identity = initialWorkspaceIdentity?.trim() || initialWorkspacePath?.trim();
    return identity ? { kind: "project", identity } : { kind: "global" };
  });
  // 修复依据：隐藏工作树子项时，选择与读取必须一起映射到可见主项目，不能隐式读取隐藏身份。
  const selectedGroup =
    requestedScope.kind === "project"
      ? mainGroups.find((group) =>
          group.workspaceTabs.some((tab) => tab.id === requestedScope.identity),
        )
      : undefined;
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedGroup?.tab.id) ?? null;
  const pending = requestedScope.kind === "project" && !selectedProject && loading;
  const isGlobalSelected = !selectedProject && !pending;
  const selectionKey = selectedProject
    ? `project:${selectedProject.identity}`
    : pending && requestedScope.kind === "project"
      ? `pending:${requestedScope.identity}`
      : "global";
  return {
    projects: visibleProjects,
    selectedProject,
    setSelectedScope,
    isGlobalSelected,
    selectionKey,
    pending,
    loading,
  };
}
