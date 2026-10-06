import { lazy, Suspense } from "react";
import { Check, ChevronLeft, GitMerge, Info, MessageSquare, X } from "lucide-react";
import { isWorkTaskMerging, type WorkTask } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { canCompleteWorkTask } from "@/lib/workTaskBoard.js";
import { Button } from "@/components/ui/button.js";
import { workTaskConversationBinding } from "@/lib/workTaskConversation.js";
import { ScopedErrorBoundary } from "@/ErrorBoundary.js";
import {
  WorkspaceHeaderActionSection,
  type WorkspaceHeaderActionSectionProps,
} from "@/WorkspaceHeaderSections/WorkspaceHeaderActionSection.js";
import { workTaskWorkspaceToolTarget } from "@/lib/workTaskWorkspaceTools.js";
import { WorkTaskActions } from "./WorkTaskActions.js";
import { WorkTaskPendingConversation } from "./WorkTaskPendingConversation.js";
import { WorkTaskIconButton, WorkTaskStatus, useWorkTaskMessages } from "./WorkTaskParts.js";
import type {
  OpenWorkTaskNativeSession,
  WorkTaskConversationOptions,
} from "./WorkTaskSessionView.js";

const WorkTaskSessionView = lazy(() =>
  import("./WorkTaskSessionView.js").then((module) => ({ default: module.WorkTaskSessionView })),
);

export type WorkTaskConversationTools = Pick<
  WorkspaceHeaderActionSectionProps,
  | "isDesktop"
  | "readOnlyReason"
  | "remoteTarget"
  | "isTerminalOpen"
  | "isSidePaneOpen"
  | "onToggleTerminal"
  | "onToggleSidePane"
  | "toggleSidePaneShortcutLabel"
> & { onOpenReview?(): void };

export function WorkTaskConversationPane({
  task,
  panel,
  options,
  workspaceTools,
  onClose,
  onDetails,
  onEdit,
  onComplete,
  onOpenConversation,
  onOpenNativeSession,
  showMergeConversation = false,
  onToggleMergeConversation,
}: {
  task: WorkTask | null;
  panel: ReturnType<typeof useWorkTasks>;
  options?: WorkTaskConversationOptions;
  workspaceTools?: WorkTaskConversationTools;
  onClose(id: string): void;
  onDetails(task: WorkTask): void;
  onEdit(task: WorkTask): void;
  onComplete(task: WorkTask): void;
  onOpenConversation(task: WorkTask): void;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  showMergeConversation?: boolean;
  onToggleMergeConversation?(): void;
}) {
  const t = useWorkTaskMessages();
  const binding = task ? workTaskConversationBinding(task, showMergeConversation) : null;
  const toolTarget = task ? workTaskWorkspaceToolTarget(task, showMergeConversation) : null;
  const hasReview = Boolean(
    task && ((task.status === "review" && !task.archived && task.worktree) || task.merge),
  );
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      data-testid="work-task-content"
    >
      {task ? (
        <>
          <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-1">
              <WorkTaskIconButton
                label={t("backToBoard")}
                data-testid="work-task-back"
                className="group-data-[wide=true]/work-task-workbench:hidden"
                onClick={() => onClose(task.id)}
              >
                <ChevronLeft className="size-4" />
              </WorkTaskIconButton>
              <h2 className="min-w-0 flex-1 truncate text-ui-base font-medium" title={task.title}>
                {task.title}
              </h2>
              <WorkTaskStatus task={task} />
              {task.merge?.session && onToggleMergeConversation ? (
                <WorkTaskIconButton
                  label={t(showMergeConversation ? "originalConversation" : "mergeConversation")}
                  data-testid="work-task-toggle-merge-conversation"
                  disabled={isWorkTaskMerging(task)}
                  onClick={onToggleMergeConversation}
                >
                  {showMergeConversation ? (
                    <MessageSquare className="size-4" />
                  ) : (
                    <GitMerge className="size-4" />
                  )}
                </WorkTaskIconButton>
              ) : null}
              <WorkTaskIconButton label={t("details")} onClick={() => onDetails(task)}>
                <Info className="size-4" />
              </WorkTaskIconButton>
              <WorkTaskActions
                task={task}
                panel={panel}
                showConversation={false}
                menu
                onEdit={onEdit}
                onComplete={onComplete}
                onOpenConversation={onOpenConversation}
              />
              <WorkTaskIconButton label={t("closeConversation")} onClick={() => onClose(task.id)}>
                <X className="size-4" />
              </WorkTaskIconButton>
            </div>
            {canCompleteWorkTask(task) ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={panel.busy}
                onClick={() => onComplete(task)}
                data-testid="work-task-complete"
              >
                <Check className="size-4" />
                {t("complete")}
              </Button>
            ) : null}
            {workspaceTools && toolTarget ? (
              <div className="ml-auto shrink-0" data-testid="work-task-workspace-tools">
                <WorkspaceHeaderActionSection
                  {...workspaceTools}
                  onToggleSidePane={
                    hasReview && !workspaceTools.isSidePaneOpen && workspaceTools.onOpenReview
                      ? workspaceTools.onOpenReview
                      : workspaceTools.onToggleSidePane
                  }
                  workspaceAbsPath={toolTarget.workspacePath}
                  workspaceIdentity={toolTarget.workspaceIdentity}
                />
              </div>
            ) : null}
          </header>
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {binding ? (
              <ScopedErrorBoundary
                scope="work-task-conversation"
                resetKeys={[task.id, binding.kind, binding.workspacePath, binding.sessionId]}
                variant="panel"
                className="h-full"
              >
                <Suspense
                  fallback={
                    <p role="status" className="p-4 text-ui-sm text-foreground-subtle">
                      {t("loading")}
                    </p>
                  }
                >
                  <WorkTaskSessionView
                    key={`${task.id}:${binding.kind}:${binding.sessionId}:${binding.workspacePath}`}
                    task={task}
                    binding={binding}
                    readOnly={
                      isWorkTaskMerging(task)
                        ? !showMergeConversation || task.merge?.phase === "applying"
                        : showMergeConversation
                    }
                    options={options}
                    onClose={onClose}
                    onOpenNativeSession={onOpenNativeSession}
                  />
                </Suspense>
              </ScopedErrorBoundary>
            ) : (
              <WorkTaskPendingConversation key={task.id} task={task} />
            )}
          </div>
        </>
      ) : (
        <div
          className="flex h-full flex-col items-center justify-center gap-3 text-ui-sm text-foreground-subtlest"
          data-testid="work-task-no-selection"
        >
          <MessageSquare aria-hidden="true" className="size-5" />
          {t("noSelection")}
        </div>
      )}
    </section>
  );
}
