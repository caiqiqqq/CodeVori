import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Play, Plus } from "lucide-react";
import { isWorkTaskMerging, type WorkTask, type WorkTaskScope } from "@zcode/shared";
import { useWorkTasks } from "@/hooks/useWorkTasks.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  WORK_TASK_ALL_PROJECTS,
  workTaskSelectionKey,
  workTaskNavigationKey,
  workTaskNavigationStore,
} from "@/store/workTaskNavigationStore.js";
import { workTaskProjectOptions } from "@/lib/workTaskProjectOptions.js";
import {
  canReviewWorkTaskCompletion,
  filterWorkTasks,
  groupWorkTasksByColumn,
} from "@/lib/workTaskBoard.js";
import {
  workTaskWorkspaceToolTarget,
  type WorkTaskWorkspaceToolTarget,
} from "@/lib/workTaskWorkspaceTools.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskCreationEditor } from "./WorkTaskCreationEditor.js";
import { WorkTaskEditor } from "./WorkTaskEditor.js";
import { WorkTaskDetail } from "./WorkTaskDetail.js";
import { WorkTaskCompletionDialog } from "./WorkTaskCompletionDialog.js";
import { WorkTaskMergeControls } from "./WorkTaskMergeControls.js";
import { WorkTaskBoardView } from "./WorkTaskBoardView.js";
import { WorkTasksSplitLayout } from "./WorkTasksSplitLayout.js";
import {
  WorkTaskConversationPane,
  type WorkTaskConversationTools,
} from "./WorkTaskConversationPane.js";
import type {
  OpenWorkTaskNativeSession,
  WorkTaskConversationOptions,
} from "./WorkTaskSessionView.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTasksBoard({
  scope,
  hasProject,
  allProjects,
  projects,
  onOpenConversation,
  header,
  onOpenNativeSession,
  conversationOptions,
  workspaceTools,
  onWorkspaceToolTargetChange,
  reviewContainer,
}: {
  scope: WorkTaskScope;
  hasProject: boolean;
  allProjects: boolean;
  projects: readonly WorkspaceTabState[];
  onOpenConversation(task: WorkTask): void;
  header: ReactNode;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  conversationOptions?: WorkTaskConversationOptions;
  workspaceTools?: WorkTaskConversationTools;
  onWorkspaceToolTargetChange?: (target: WorkTaskWorkspaceToolTarget | null) => void;
  reviewContainer?: HTMLElement | null;
}) {
  const t = useWorkTaskMessages();
  const [editor, setEditor] = useState<{ task: WorkTask | null } | null>(null);
  const navigationScope = useMemo(
    () => (allProjects ? { workspacePath: WORK_TASK_ALL_PROJECTS } : scope),
    [allProjects, scope],
  );
  const selectionKey = workTaskNavigationKey(navigationScope);
  const taskKey = (task: WorkTask) => (allProjects ? workTaskSelectionKey(task) : task.id);
  const selection = useStore(workTaskNavigationStore, (state) => state.tasks[selectionKey] ?? null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [conversationView, setConversationView] = useState<{
    taskId: string;
    mergeId: string;
    merge: boolean;
  } | null>(null);
  const panel = useWorkTasks(scope, false, hasProject, allProjects ? projects : undefined);
  const tasks = useMemo(() => filterWorkTasks(panel.board?.tasks ?? [], {}), [panel.board?.tasks]);
  const selected = tasks.find((task) => taskKey(task) === selection);
  const completionTask = tasks.find((task) => taskKey(task) === completionId);
  if (completionId && (!completionTask || !canReviewWorkTaskCompletion(completionTask)))
    setCompletionId(null);
  const showMergeConversation =
    !!selected?.merge?.session &&
    (isWorkTaskMerging(selected) ||
      (conversationView?.taskId === taskKey(selected) &&
        conversationView.mergeId === selected.merge.id &&
        conversationView.merge));
  const toolTarget = useMemo(
    () => (selected ? workTaskWorkspaceToolTarget(selected, showMergeConversation) : null),
    [selected, showMergeConversation],
  );
  // 工具目标只投影已选任务；布局同步在绘制前完成，不让首次点击沿用主项目目录。
  useLayoutEffect(() => {
    onWorkspaceToolTargetChange?.(toolTarget);
  }, [onWorkspaceToolTargetChange, toolTarget]);
  useLayoutEffect(() => () => onWorkspaceToolTargetChange?.(null), [onWorkspaceToolTargetChange]);
  const details = panel.board?.tasks.find((task) => taskKey(task) === detailsId);
  useEffect(() => {
    // 首次成功读取才能确认任务已不可见；断连、加载或读取失败不清除恢复位置。
    if (selection && panel.board && panel.settled && !panel.error && !selected)
      workTaskNavigationStore.getState().clearTask(navigationScope, selection);
  }, [navigationScope, selection, selected, panel.board, panel.settled, panel.error]);
  const columns = useMemo(() => groupWorkTasksByColumn(tasks), [tasks]);
  const selectTask = (id: string) => {
    setCompletionId(null);
    workTaskNavigationStore.getState().selectTask(navigationScope, id);
  };
  const openInline = (task: WorkTask) => selectTask(taskKey(task));
  const requestCompletion = (task: WorkTask) => {
    if (canReviewWorkTaskCompletion(task)) setCompletionId(taskKey(task));
  };
  const closeCompletion = useCallback(
    (id: string) => {
      if (completionTask?.id === id) {
        const expected = taskKey(completionTask);
        setCompletionId((current) => (current === expected ? null : current));
      }
    },
    [completionTask],
  );
  const closeSelection = useCallback(
    (id: string) => {
      if (selected?.id === id)
        workTaskNavigationStore.getState().clearTask(navigationScope, taskKey(selected));
    },
    [navigationScope, selected],
  );
  const edit = (task: WorkTask) => {
    setDetailsId(null);
    setEditor({ task });
  };
  return (
    <>
      {selected &&
      ((selected.status === "review" && !selected.archived && selected.worktree) ||
        selected.merge) ? (
        <WorkTaskMergeControls
          key={workTaskSelectionKey(selected)}
          task={selected}
          panel={panel.forScope(selected)}
          container={reviewContainer ?? null}
        />
      ) : null}
      <WorkTasksSplitLayout
        hasSelection={Boolean(selected)}
        sidebar={
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            {header}
            <div
              className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-2"
              data-testid="work-task-actions"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={
                  panel.loading ||
                  panel.busy ||
                  !panel.executable ||
                  !panel.board?.tasks.some(
                    (task) =>
                      !task.archived && task.status === "todo" && panel.forScope(task).executable,
                  )
                }
                onClick={() => {
                  void panel.startAll();
                }}
                data-testid="work-task-start-all"
              >
                <Play className="size-4" />
                {t("startAll")}
              </Button>
              <Button
                size="sm"
                disabled={panel.busy || panel.loading || !panel.board || !hasProject}
                onClick={() => {
                  setDetailsId(null);
                  setEditor({ task: null });
                }}
                data-testid="work-task-new"
              >
                <Plus className="size-4" />
                {t("create")}
              </Button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
              aria-busy={panel.loading}
              data-testid="work-task-board-scroll"
            >
              {panel.error ? (
                <div className="px-4 py-3">
                  <WorkTaskError error={panel.error} />
                </div>
              ) : null}
              {panel.loading ? (
                <p role="status" className="px-4 py-3 text-ui-sm text-foreground-subtle">
                  {t("loading")}
                </p>
              ) : (
                <WorkTaskBoardView
                  columns={columns}
                  panel={panel}
                  panelForTask={panel.forScope}
                  taskKey={taskKey}
                  projectOptions={allProjects ? workTaskProjectOptions(projects) : undefined}
                  onSelect={selectTask}
                  onEdit={edit}
                  onOpenConversation={openInline}
                  onDetails={(task) => setDetailsId(taskKey(task))}
                  onComplete={requestCompletion}
                  selectedId={selected ? taskKey(selected) : undefined}
                />
              )}
            </div>
          </div>
        }
        conversation={
          <WorkTaskConversationPane
            task={selected ?? null}
            showMergeConversation={showMergeConversation}
            onToggleMergeConversation={() => {
              if (selected?.merge)
                setConversationView({
                  taskId: taskKey(selected),
                  mergeId: selected.merge.id,
                  merge: !showMergeConversation,
                });
            }}
            panel={selected ? panel.forScope(selected) : panel}
            options={{
              ...conversationOptions,
              focused:
                conversationOptions?.focused !== false && !editor && !details && !completionTask,
            }}
            workspaceTools={workspaceTools}
            onClose={closeSelection}
            onDetails={(task) => setDetailsId(taskKey(task))}
            onEdit={edit}
            onComplete={requestCompletion}
            onOpenConversation={onOpenConversation}
            onOpenNativeSession={onOpenNativeSession}
          />
        }
      />
      {completionTask && canReviewWorkTaskCompletion(completionTask) ? (
        <WorkTaskCompletionDialog
          key={`${workTaskSelectionKey(completionTask)}:${completionTask.runSeq}`}
          task={completionTask}
          panel={panel.forScope(completionTask)}
          onClose={closeCompletion}
        />
      ) : null}
      {editor?.task ? (
        <WorkTaskEditor
          key={workTaskSelectionKey(editor.task)}
          scope={panel.forScope(editor.task).scope}
          task={editor.task}
          busy={panel.busy}
          error={panel.error}
          startAfterSave={panel.forScope(editor.task).executable}
          onClose={() => setEditor(null)}
          onSave={(draft) =>
            panel
              .forScope(editor.task!)
              .update({ ...draft, id: editor.task!.id }, panel.forScope(editor.task!).executable)
          }
        />
      ) : editor ? (
        <WorkTaskCreationEditor
          scope={scope}
          projects={allProjects ? projects : undefined}
          panel={panel}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {details && !editor ? (
        <WorkTaskDetail
          key={workTaskSelectionKey(details)}
          task={details}
          panel={panel.forScope(details)}
          onClose={() => setDetailsId(null)}
          onEdit={() => edit(details)}
          onOpenConversation={(task) => {
            openInline(task);
            setDetailsId(null);
          }}
        />
      ) : null}
    </>
  );
}
