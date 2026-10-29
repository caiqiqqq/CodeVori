import { useMemo, useRef, useState } from "react";
import { isWorkTaskMerging } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { canReviewWorkTaskCompletion } from "@/lib/workTaskBoard.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { WorkTaskConversationPane } from "@/work-tasks/WorkTaskConversationPane.js";
import { WorkTaskCompletionDialog } from "@/work-tasks/WorkTaskCompletionDialog.js";
import { WorkTaskEditor } from "@/work-tasks/WorkTaskEditor.js";
import { WorkTaskDetail } from "@/work-tasks/WorkTaskDetail.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { BoardItem } from "./agentBoardModel.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";
import { workTaskConversationBinding } from "@/lib/workTaskConversation.js";
import { usePaneGitStatus } from "@/hooks/usePaneGitStatus.js";

export function AgentBoardWorkTaskDetails({
  item,
  workTasks,
  options,
  onClose,
  onOpenSession,
}: {
  item: Extract<BoardItem, { kind: "work-task" }>;
  workTasks: ReturnType<typeof useWorkTasks>;
  options?: BoardConversationOptions;
  onClose(): void;
  onOpenSession(item: BoardItem): void;
}) {
  const { intl } = useZCodeIntl();
  const contentRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<"complete" | "edit" | "details" | null>(null);
  const [merge, setMerge] = useState(false);
  const task = item.workTask;
  const panel = workTasks.forScope(task);
  const showMerge = isWorkTaskMerging(task) || merge;
  const binding = workTaskConversationBinding(task, showMerge);
  const gitScope = useMemo(
    () => ({ workspacePath: binding?.workspacePath ?? task.workspacePath }),
    [binding?.workspacePath, task.workspacePath],
  );
  // 待办的代码归属执行或合并工作树；没有本地会话绑定时不读取根目录或远端替代值。
  const git = usePaneGitStatus(
    gitScope,
    item.online && Boolean(binding),
    options?.onOpenScopedGitReview,
  );
  const completing = modal === "complete" && canReviewWorkTaskCompletion(task);
  // 原任务已离开验收阶段时丢弃弹窗草稿，后续新一轮不能自动重开旧确认。
  if (modal === "complete" && !completing) setModal(null);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            // 首个返回按钮带 Tooltip；聚焦容器避免 Esc 先被提示层消耗而无法关闭详情。
            event.preventDefault();
            contentRef.current?.focus();
          }}
          showCloseButton={!item.online}
          className="inset-y-0 right-0 left-auto flex h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">{task.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({ id: "agentBoard.workTasks" })}
          </DialogDescription>
          {item.online ? (
            <WorkTaskConversationPane
              task={task}
              panel={panel}
              options={{
                ...options,
                focused: !modal,
                statusPanel: binding
                  ? {
                      ...git,
                      workspaceKey: gitScope.workspacePath,
                      onOpenGitReview: git.onOpenGitReview
                        ? (sourceId) => {
                            onClose();
                            git.onOpenGitReview?.(sourceId);
                          }
                        : undefined,
                    }
                  : undefined,
              }}
              showMergeConversation={showMerge}
              onToggleMergeConversation={() => setMerge(!showMerge)}
              onClose={onClose}
              onDetails={() => setModal("details")}
              onEdit={() => setModal("edit")}
              onComplete={() => {
                if (canReviewWorkTaskCompletion(task)) setModal("complete");
              }}
              onOpenConversation={() => onOpenSession(item)}
            />
          ) : (
            <p className="p-4 text-warning">{intl.formatMessage({ id: "agentBoard.offline" })}</p>
          )}
        </DialogContent>
      </Dialog>
      {item.online && completing ? (
        <WorkTaskCompletionDialog
          key={task.runSeq}
          task={task}
          panel={panel}
          onClose={() => setModal(null)}
        />
      ) : null}
      {item.online && modal === "edit" ? (
        <WorkTaskEditor
          task={task}
          scope={panel.scope}
          busy={panel.busy}
          error={panel.error}
          startAfterSave={panel.executable}
          onClose={() => setModal(null)}
          onSave={(draft) => panel.update({ ...draft, id: task.id }, panel.executable)}
        />
      ) : null}
      {item.online && modal === "details" ? (
        <WorkTaskDetail
          task={task}
          panel={panel}
          onClose={() => setModal(null)}
          onEdit={() => setModal("edit")}
          onOpenConversation={() => setModal(null)}
        />
      ) : null}
    </>
  );
}
