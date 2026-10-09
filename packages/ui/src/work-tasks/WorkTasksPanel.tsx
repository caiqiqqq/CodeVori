import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { ListTodo } from "lucide-react";
import { type WorkTask, type WorkTaskScope } from "@zcode/shared";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  WORK_TASK_ALL_PROJECTS,
  workTaskNavigationKey,
  workTaskNavigationStore,
} from "@/store/workTaskNavigationStore.js";
import { workTaskProjectOptions } from "@/lib/workTaskProjectOptions.js";
import { type WorkTaskWorkspaceToolTarget } from "@/lib/workTaskWorkspaceTools.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { WorkTasksBoard } from "./WorkTasksBoard.js";
import { type WorkTaskConversationTools } from "./WorkTaskConversationPane.js";
import type {
  OpenWorkTaskNativeSession,
  WorkTaskConversationOptions,
} from "./WorkTaskSessionView.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

export interface WorkTasksPanelProps extends WorkTaskScope {
  workspaceTabs: readonly Omit<WorkspaceTabState, "kind" | "id">[];
  onOpenConversation(task: WorkTask): void;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  conversationOptions?: WorkTaskConversationOptions;
  workspaceTools?: WorkTaskConversationTools;
  onWorkspaceToolTargetChange?: (target: WorkTaskWorkspaceToolTarget | null) => void;
  reviewContainer?: HTMLElement | null;
}

export function WorkTasksPanel(props: WorkTasksPanelProps) {
  const t = useWorkTaskMessages();
  const workspaceTabs = useMemo(
    () =>
      props.workspaceTabs
        .filter((tab) => tab.workspacePurpose !== "conversation")
        .map((tab) => ({
          ...tab,
          id: tab.workspaceIdentity?.trim() || tab.workspacePath,
          kind: "workspace" as const,
        })),
    [props.workspaceTabs],
  );
  const {
    resolvedGroups: groups,
    loading: projectsLoading,
    hasResolvedRelations,
  } = useWorktreeProjectGroupsResolution(workspaceTabs);
  const options = useMemo(
    () =>
      workTaskProjectOptions(
        groups
          .filter(
            (group) => group.tab.workspacePurpose !== "conversation" && !group.isLinkedWorktree,
          )
          .map((group) => group.tab),
      ),
    [groups],
  );
  const projects = useMemo(() => options.map((option) => option.tab), [options]);
  const current = groups.find((group) =>
    group.workspaceTabs.some(
      (tab) =>
        (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
        (props.workspaceIdentity?.trim() || props.workspacePath),
    ),
  )?.tab;
  const selection = useStore(workTaskNavigationStore, (state) => state.project);
  // 普通对话不是任务项目；不能在未选项目时回退默认 cwd 并继承用户主目录仓库。
  const selected =
    projects.find((tab) => workTaskNavigationKey(tab) === selection) ??
    projects.find((tab) => tab === current) ??
    projects[0];
  const scope = selected
    ? {
        workspacePath: selected.workspacePath,
        workspaceIdentity: selected.workspaceIdentity,
        remoteSessionId: selected.remoteSessionId,
      }
    : {
        workspacePath: props.workspacePath,
        workspaceIdentity: props.workspaceIdentity,
        remoteSessionId: props.remoteSessionId,
      };
  const allProjects = selection === WORK_TASK_ALL_PROJECTS;
  const key = allProjects ? WORK_TASK_ALL_PROJECTS : workTaskNavigationKey(scope);
  useEffect(() => {
    // 项目关系确认后才保存默认选择，防止启动占位覆盖上次选中的项目。
    if (!allProjects && hasResolvedRelations && !projectsLoading && selected)
      workTaskNavigationStore.getState().selectProject(selected);
  }, [allProjects, hasResolvedRelations, projectsLoading, selected]);
  const header = (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <ListTodo className="size-4 shrink-0 text-foreground-subtle" />
      <h2 className="min-w-0 flex-1 text-ui-base font-medium">{t("title")}</h2>
      <Select
        value={allProjects || selected ? key : ""}
        onValueChange={(value) => {
          if (value === WORK_TASK_ALL_PROJECTS) {
            workTaskNavigationStore.getState().selectAllProjects();
            return;
          }
          const project = projects.find((tab) => workTaskNavigationKey(tab) === value);
          if (project) workTaskNavigationStore.getState().selectProject(project);
        }}
        disabled={projectsLoading || !projects.length}
      >
        <SelectTrigger
          aria-label={t("project")}
          className="max-w-56"
          data-testid="work-task-project"
        >
          <SelectValue placeholder={t(projectsLoading ? "loading" : "noProject")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WORK_TASK_ALL_PROJECTS}>{t("allProjects")}</SelectItem>
          {!projectsLoading &&
            options.map(({ tab, label, description }) => (
              <SelectItem key={workTaskNavigationKey(tab)} value={workTaskNavigationKey(tab)}>
                <span className="flex min-w-0 flex-col" title={description}>
                  <span>{label}</span>
                  {description ? (
                    <span className="break-all text-ui-xs text-foreground-subtle">
                      {description}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </header>
  );
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
      data-testid="work-tasks-panel"
    >
      {!hasResolvedRelations ? (
        <>
          {header}
          <p role="status" className="px-4 py-3 text-ui-sm text-foreground-subtle">
            {t("loading")}
          </p>
        </>
      ) : (
        <WorkTasksBoard
          key={key}
          scope={scope}
          allProjects={allProjects}
          projects={projects}
          hasProject={Boolean(selected)}
          header={header}
          onOpenConversation={props.onOpenConversation}
          onOpenNativeSession={props.onOpenNativeSession}
          conversationOptions={props.conversationOptions}
          workspaceTools={props.workspaceTools}
          onWorkspaceToolTargetChange={props.onWorkspaceToolTargetChange}
          reviewContainer={props.reviewContainer}
        />
      )}
    </div>
  );
}
