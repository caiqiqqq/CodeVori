import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { ListTodo, Play, Plus } from "lucide-react";
import { isWorkTaskMerging, type WorkTask, type WorkTaskScope } from "@zcode/shared";
import { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { useWorktreeProjectGroups } from "@/hooks/useWorktreeProjectGroups.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  canCompleteWorkTask,
  filterWorkTasks,
  groupWorkTasksByColumn,
} from "@/lib/workTaskBoard.js";
import {
  workTaskWorkspaceToolTarget,
  type WorkTaskWorkspaceToolTarget,
} from "@/lib/workTaskWorkspaceTools.js";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
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

interface Props extends WorkTaskScope {
  workspaceTabs: readonly Omit<WorkspaceTabState, "kind" | "id">[];
  onOpenConversation(task: WorkTask): void;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  conversationOptions?: WorkTaskConversationOptions;
  workspaceTools?: WorkTaskConversationTools;
  onWorkspaceToolTargetChange?: (target: WorkTaskWorkspaceToolTarget | null) => void;
  reviewContainer?: HTMLElement | null;
}

export function WorkTasksPanel(props: Props) {
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
  const groups = useWorktreeProjectGroups(workspaceTabs);
  const projects = groups
    .filter((group) => group.tab.workspacePurpose !== "conversation" && !group.isLinkedWorktree)
    .map((group) => group.tab);
  const current = groups.find((group) =>
    group.workspaceTabs.some(
      (tab) =>
        (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
        (props.workspaceIdentity?.trim() || props.workspacePath),
    ),
  )?.tab;
  const [selection, setSelection] = useState<string | null>(null);
  // 普通对话不是任务项目；不能在未选项目时回退默认 cwd 并继承用户主目录仓库。
  const selected =
    projects.find((tab) => (tab.workspaceIdentity?.trim() || tab.workspacePath) === selection) ??
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
  const key = scope.workspaceIdentity?.trim() || scope.workspacePath;
  const header = (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <ListTodo className="size-4 shrink-0 text-foreground-subtle" />
      <h2 className="min-w-0 flex-1 text-ui-base font-medium">{t("title")}</h2>
      <Select value={selected ? key : ""} onValueChange={setSelection} disabled={!projects.length}>
        <SelectTrigger
          aria-label={t("project")}
          className="max-w-56"
          data-testid="work-task-project"
        >
          <SelectValue placeholder={t("noProject")} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((tab) => (
            <SelectItem key={tab.id} value={tab.workspaceIdentity?.trim() || tab.workspacePath}>
              {tab.label || getPathLeaf(tab.workspacePath)}
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
      <WorkTasksBoard
        key={key}
        scope={scope}
        hasProject={Boolean(selected)}
        header={header}
        onOpenConversation={props.onOpenConversation}
        onOpenNativeSession={props.onOpenNativeSession}
        conversationOptions={props.conversationOptions}
        workspaceTools={props.workspaceTools}
        onWorkspaceToolTargetChange={props.onWorkspaceToolTargetChange}
        reviewContainer={props.reviewContainer}
      />
    </div>
  );
}

function WorkTasksBoard({
  scope,
  hasProject,
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
  onOpenConversation(task: WorkTask): void;
  header: ReactNode;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  conversationOptions?: WorkTaskConversationOptions;
  workspaceTools?: WorkTaskConversationTools;
  onWorkspaceToolTargetChange?: Props["onWorkspaceToolTargetChange"];
  reviewContainer?: HTMLElement | null;
}) {
  const t = useWorkTaskMessages();
  const [editor, setEditor] = useState<{ task: WorkTask | null } | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [conversationView, setConversationView] = useState<{
    taskId: string;
    mergeId: string;
    merge: boolean;
  } | null>(null);
  const panel = useWorkTasks(scope, false, hasProject);
  const tasks = useMemo(() => filterWorkTasks(panel.board?.tasks ?? [], {}), [panel.board?.tasks]);
  const selected = tasks.find((task) => task.id === selection);
  const completionTask = tasks.find((task) => task.id === completionId);
  if (completionId && (!completionTask || !canCompleteWorkTask(completionTask)))
    setCompletionId(null);
  const showMergeConversation =
    !!selected?.merge?.session &&
    (isWorkTaskMerging(selected) ||
      (conversationView?.taskId === selected.id &&
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
  const details = panel.board?.tasks.find((task) => task.id === detailsId);
  // Host 归档或取消任务后立即收起观察窗格，任务恢复可见时不能重开旧历史。
  if (selection && panel.board && !panel.loading && !selected) setSelection(null);
  const columns = useMemo(() => groupWorkTasksByColumn(tasks), [tasks]);
  const selectTask = (id: string) => {
    setCompletionId(null);
    setSelection(id);
  };
  const openInline = (task: WorkTask) => selectTask(task.id);
  const requestCompletion = (task: WorkTask) => {
    if (canCompleteWorkTask(task)) setCompletionId(task.id);
  };
  const closeCompletion = useCallback((id: string) => {
    setCompletionId((current) => (current === id ? null : current));
  }, []);
  const closeSelection = useCallback((id: string) => {
    // 旧 pane 的迟到归档/删除事件只能关闭当时选择的任务。
    setSelection((current) => (current === id ? null : current));
  }, []);
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
          key={selected.id}
          task={selected}
          panel={panel}
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
                  !panel.board?.tasks.some((task) => !task.archived && task.status === "todo")
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
                  onSelect={selectTask}
                  onEdit={edit}
                  onOpenConversation={openInline}
                  onDetails={(task) => setDetailsId(task.id)}
                  onComplete={requestCompletion}
                  selectedId={selected?.id}
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
                  taskId: selected.id,
                  mergeId: selected.merge.id,
                  merge: !showMergeConversation,
                });
            }}
            panel={panel}
            options={{
              ...conversationOptions,
              focused:
                conversationOptions?.focused !== false && !editor && !details && !completionTask,
            }}
            workspaceTools={workspaceTools}
            onClose={closeSelection}
            onDetails={(task) => setDetailsId(task.id)}
            onEdit={edit}
            onComplete={requestCompletion}
            onOpenConversation={onOpenConversation}
            onOpenNativeSession={onOpenNativeSession}
          />
        }
      />
      {completionTask && canCompleteWorkTask(completionTask) ? (
        <WorkTaskCompletionDialog
          key={completionTask.id}
          task={completionTask}
          panel={panel}
          onClose={closeCompletion}
        />
      ) : null}
      {editor ? (
        <WorkTaskEditor
          key={editor.task?.id ?? "new"}
          scope={scope}
          task={editor.task}
          busy={panel.busy}
          error={panel.error}
          startAfterSave={!!editor.task && panel.executable}
          onClose={() => setEditor(null)}
          onSave={(draft) =>
            editor.task
              ? panel.update({ ...draft, id: editor.task.id }, panel.executable)
              : panel.create(draft)
          }
        />
      ) : null}
      {details && !editor ? (
        <WorkTaskDetail
          key={details.id}
          task={details}
          panel={panel}
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
