import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TID_V4_QUEUE, TID_V4_QUEUE_PAUSED_BANNER, TID_V4_QUEUE_RESUME } from "@zcode/shared";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { ConversationQueueRow } from "@/v4/ConversationQueueRow.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";

interface ConversationQueuePanelProps {
  queue: QueueState;
  /** 临时发送反馈，不计入 accepted queue，也不提供队列命令。 */
  pendingSubmission?: { commandId: string; text: string } | null;
  /** 删除队列项（deleteQueueItem command）。 */
  onDeleteItem?: (queueItemId: string) => void;
  /** 撤回队列项到发起端 composer；权威删除成功后才恢复草稿。 */
  onEditItem?: (queueItemId: string) => Promise<void> | void;
  /** 正在等待 delete ACK / composer restore 的目标项；仅锁该 row。 */
  pendingEditQueueItemId?: string | null;
  /** 立即发送队列项（sendQueuedNow command，stop 当前 + 消费该项）。 */
  onSendNow?: (queueItemId: string) => void;
  /** 拖拽排序项（reorderQueueItem，移动到锚点前；null=队尾）。 */
  onMoveItem?: (queueItemId: string, beforeQueueItemId: string | null) => void;
  /** 暂停队列恢复：CLI setAutoDrain(true)，idle 立即消费、busy 仅武装。 */
  onResume?: () => Promise<void> | void;
}

type QueueItem = QueueState["items"][number];

interface V4QueueReorderAnchor {
  beforeQueueItemId: string | null;
  queueItemId: string;
}

function resolveV4QueueReorderAnchor(
  items: readonly QueueItem[],
  activeQueueItemId: string,
  overQueueItemId: string,
): V4QueueReorderAnchor | null {
  if (activeQueueItemId === overQueueItemId) {
    return null;
  }

  const fromIndex = items.findIndex((item) => item.queueItemId === activeQueueItemId);
  const overIndex = items.findIndex((item) => item.queueItemId === overQueueItemId);
  if (fromIndex < 0 || overIndex < 0) {
    return null;
  }

  if (fromIndex < overIndex) {
    const itemsAfterRemoval = items.filter((item) => item.queueItemId !== activeQueueItemId);
    const overIndexAfterRemoval = itemsAfterRemoval.findIndex(
      (item) => item.queueItemId === overQueueItemId,
    );
    const nextItem = itemsAfterRemoval[overIndexAfterRemoval + 1];
    return {
      beforeQueueItemId: nextItem?.queueItemId ?? null,
      queueItemId: activeQueueItemId,
    };
  }

  return {
    beforeQueueItemId: overQueueItemId,
    queueItemId: activeQueueItemId,
  };
}

const restrictQueueDragToPanel: Modifier = ({
  transform,
  draggingNodeRect,
  activeNodeRect,
  containerNodeRect,
  windowRect,
}) => {
  const nodeRect = draggingNodeRect ?? activeNodeRect;
  const boundaryRect = containerNodeRect ?? windowRect;
  if (!nodeRect || !boundaryRect) {
    return {
      ...transform,
      x: 0,
    };
  }

  const minY = boundaryRect.top - nodeRect.top;
  const maxY = boundaryRect.bottom - nodeRect.bottom;
  return {
    ...transform,
    x: 0,
    y: Math.min(Math.max(transform.y, minY), maxY),
  };
};

/**
 * 竖切 queue 面板：渲染 projection.queue.items + 单项删除入口。
 * API/ACP queue 均读取所属 Host 的权威投影，Renderer 不保留第二份已接受队列。
 */
function ConversationQueuePanelImpl({
  queue,
  pendingSubmission,
  onDeleteItem,
  onEditItem,
  pendingEditQueueItemId = null,
  onSendNow,
  onMoveItem,
  onResume,
}: ConversationQueuePanelProps) {
  const { intl } = useZCodeIntl();
  const [resumePending, setResumePending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingCommandId = pendingSubmission?.commandId;
  useLayoutEffect(() => {
    // 修复原因：长列表的队尾在内部滚动区外；只滚动本列表，让提交反馈在首帧可见。
    if (pendingCommandId && listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [pendingCommandId]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const itemIds = useMemo(() => queue.items.map((item) => item.queueItemId), [queue.items]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const overId = event.over?.id;
      if (!overId) return;
      const anchor = resolveV4QueueReorderAnchor(
        queue.items,
        String(event.active.id),
        String(overId),
      );
      if (!anchor) return;
      onMoveItem?.(anchor.queueItemId, anchor.beforeQueueItemId);
    },
    [onMoveItem, queue.items],
  );
  const handleResume = useCallback(async () => {
    if (!onResume || resumePending) return;
    setResumePending(true);
    try {
      await runUserActionAsync({
        input: { featureId: "conversation.queue.policy", action: "resume", trigger: "button" },
        operation: () => Promise.resolve(onResume()),
        completed: { resultSource: "authority_ack" },
        failureStage: "queue_resume",
      });
    } finally {
      setResumePending(false);
    }
  }, [onResume, resumePending]);

  if (queue.items.length === 0 && !pendingSubmission) return null;
  // 补回 v4 视觉迁移时漏掉的旧队列面板 blur 层，让列表保持贴合 composer 的磨砂背景。
  return (
    <div
      data-testid={TID_V4_QUEUE}
      data-queue-count={queue.items.length}
      data-queue-auto-drain={queue.autoDrain ? "true" : "false"}
      className={cn(
        "relative z-0 w-full overflow-hidden rounded-t-2xl border border-border bg-surface p-1 backdrop-blur-md",
        "-mb-7 pb-7",
      )}
    >
      {!queue.autoDrain && queue.items.length > 0 ? (
        <div
          data-testid={TID_V4_QUEUE_PAUSED_BANNER}
          className="mb-1 flex min-h-10 items-center gap-3 rounded-xl border border-border/70 bg-surface-raised px-3 py-2 text-ui-base text-foreground"
        >
          <span className="min-w-0 flex-1">
            {intl.formatMessage({
              id:
                queue.pauseReason === "stopped"
                  ? "chat.queue.paused.stopped"
                  : queue.pauseReason === "error"
                    ? "chat.queue.paused.error"
                    : "chat.queue.paused.generic",
            })}
          </span>
          {onResume ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={TID_V4_QUEUE_RESUME}
              aria-label={intl.formatMessage({ id: "chat.queue.resume.description" })}
              disabled={resumePending}
              className="shrink-0 text-foreground-subtle hover:text-foreground"
              onClick={() => void handleResume()}
            >
              {intl.formatMessage({ id: "chat.queue.resume" })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictQueueDragToPanel]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {/* 队列曾无限撑高 sticky dock，分屏时会把 composer 挤出 pane；
              cqh 读取 SessionPane 的 size container，让短窗格也按自身高度限制列表。 */}
          <ul
            ref={listRef}
            data-v4-queue-list="true"
            className="max-h-[min(12rem,30cqh)] space-y-0.5 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            {queue.items.map((item, index) => (
              <ConversationQueueRow
                key={item.queueItemId}
                item={item}
                index={index}
                intl={intl}
                sortable={Boolean(onMoveItem)}
                onDeleteItem={onDeleteItem}
                onEditItem={onEditItem}
                onSendNow={onSendNow}
                editPending={pendingEditQueueItemId === item.queueItemId}
              />
            ))}
            {pendingSubmission ? (
              <li
                data-testid="v4-queue-submission"
                data-command-id={pendingSubmission.commandId}
                role="status"
                aria-live="polite"
                className="flex min-h-9 items-center gap-2 rounded-xl px-3 py-1 text-ui-base text-foreground-subtle"
              >
                <Spinner aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={pendingSubmission.text}>
                  {pendingSubmission.text}
                </span>
                <span className="shrink-0 text-ui-sm">
                  {intl.formatMessage({ id: "chat.queue.adding" })}
                </span>
              </li>
            ) : null}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export const ConversationQueuePanel = memo(ConversationQueuePanelImpl);
