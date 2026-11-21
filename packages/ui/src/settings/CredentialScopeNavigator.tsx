import { useMemo } from "react";
import { Folder, GitBranch, Globe2 } from "lucide-react";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";

export interface CredentialScopeProject extends Pick<
  WorkspaceTabState,
  "workspacePath" | "workspaceIdentity" | "remoteSessionId" | "remoteTarget"
> {
  identity: string;
  label: string;
}

export function CredentialScopeNavigator({
  projects,
  selectedProjectIdentity,
  isGlobalSelected,
  label,
  onGlobalSelect,
  onProjectSelect,
}: {
  projects: CredentialScopeProject[];
  selectedProjectIdentity: string;
  isGlobalSelected: boolean;
  label: (id: string) => string;
  onGlobalSelect: () => void;
  onProjectSelect: (identity: string) => void;
}) {
  const tabs = useMemo<WorkspaceTabState[]>(
    () => projects.map((project) => ({ ...project, id: project.identity, kind: "workspace" })),
    [projects],
  );
  // 中文依据：最近目录含主仓库及多个工作树；只合并展示层级，查询和关联仍使用各自身份。
  const { resolvedGroups, loading } = useWorktreeProjectGroupsResolution(tabs);
  const rowClass = (selected: boolean) =>
    `flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-ui-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand ${selected ? "border-border-hover bg-card-selected text-foreground" : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground"}`;

  return (
    <nav
      aria-label={label("settings.credentials.projectsHeading")}
      className="min-w-0 rounded-xl border border-border bg-card p-2"
    >
      <h3 className="px-2 py-1.5 text-ui-sm font-semibold text-foreground-subtlest">
        {label("settings.credentials.projectsHeading")}
      </h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto md:max-h-[calc(100dvh-18rem)]">
        <li>
          <button
            type="button"
            aria-pressed={isGlobalSelected}
            className={rowClass(isGlobalSelected)}
            onClick={onGlobalSelect}
          >
            <Globe2 className="size-4 shrink-0" aria-hidden="true" />
            <span>{label("settings.credentials.globalScope")}</span>
          </button>
        </li>
        {resolvedGroups.map(({ tab: project, worktrees, isLinkedWorktree }) => (
          <li key={project.id}>
            <button
              type="button"
              aria-pressed={project.id === selectedProjectIdentity}
              title={project.workspacePath}
              className={rowClass(project.id === selectedProjectIdentity)}
              onClick={() => onProjectSelect(project.id)}
            >
              {isLinkedWorktree ? (
                <GitBranch className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <Folder className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{project.label}</span>
                <span className="mt-0.5 block truncate text-ui-xs font-normal text-foreground-subtlest">
                  {project.workspacePath}
                </span>
              </span>
            </button>
            {worktrees.length ? (
              <ul className="ml-3 space-y-1 border-l border-border pl-2">
                {worktrees.map(({ tab, branchName }) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      aria-pressed={tab.id === selectedProjectIdentity}
                      title={tab.workspacePath}
                      className={rowClass(tab.id === selectedProjectIdentity)}
                      onClick={() => onProjectSelect(tab.id)}
                    >
                      <GitBranch className="size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{branchName || tab.workspacePath}</span>
                        <span className="mt-0.5 block truncate text-ui-xs font-normal text-foreground-subtlest">
                          {tab.workspacePath}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {loading ? (
        <p role="status" className="px-2 py-2 text-ui-sm text-foreground-subtle">
          {label("settings.credentials.loading")}
        </p>
      ) : null}
      {!loading && projects.length === 0 ? (
        <p className="px-2 py-2 text-ui-sm text-foreground-subtle">
          {label("settings.credentials.projectsEmpty")}
        </p>
      ) : null}
    </nav>
  );
}
