import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useMemo, type CSSProperties } from "react";
import {
  TID_V4_QUEUE_ITEM,
  TID_V4_QUEUE_ITEM_DELETE,
  TID_V4_QUEUE_ITEM_EDIT,
  TID_V4_QUEUE_ITEM_SEND_NOW,
  testId,
} from "@zcode/shared";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";
import { ArrowUpFromLine, GripVertical, PencilIcon, Trash2Icon } from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

type QueueItem = QueueState["items"][number];

interface QueueRowProps {
  item: QueueItem;
  index: number;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  sortable: boolean;
  onDeleteItem?: (queueItemId: string) => void;
  onEditItem?: (queueItemId: string) => Promise<void> | void;
  editPending: boolean;
  onSendNow?: (queueItemId: string) => void;
}

export const ConversationQueueRow = memo(function ConversationQueueRow({
  item,
  index,
  intl,
  sortable,
  onDeleteItem,
  onEditItem,
  onSendNow,
  editPending,
}: QueueRowProps) {
  const dispatchLocked = item.dispatch.state !== "queued";
  const rowLocked = dispatchLocked || editPending;
  const isCompact = item.kind === "compact";
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    disabled: !sortable || rowLocked,
    id: item.queueItemId,
  });

  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(
        transform
          ? {
              ...transform,
              // dnd-kit 排序时会按 over 节点尺寸附带 scale；
              // 队列行是固定触控目标，缩放会让拖拽中的按钮和文本短暂变形。
              scaleX: 1,
              scaleY: 1,
            }
          : null,
      ),
      transition,
      zIndex: isDragging ? 10 : undefined,
    }),
    [isDragging, transition, transform],
  );
  return (
    <li
      ref={setNodeRef}
      data-testid={testId(TID_V4_QUEUE_ITEM, item.queueItemId)}
      data-queue-item-id={item.queueItemId}
      data-index={index}
      data-kind={item.kind}
      data-dispatch-state={item.dispatch.state}
      data-edit-pending={editPending ? "true" : "false"}
      className={cn(
        "relative flex items-center gap-2 rounded-xl px-1.5 py-1 pr-1 transition-colors hover:bg-hover/30",
        isDragging ? "bg-hover/40 shadow-sm" : null,
        editPending ? "opacity-60" : null,
      )}
      style={style}
    >
      <ControlHintTooltip title={intl.formatMessage({ id: "chat.queue.drag" })}>
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon-md"
          data-v4-queue-drag-handle="true"
          data-queue-item-id={item.queueItemId}
          aria-label={intl.formatMessage({ id: "chat.queue.drag" })}
          className="shrink-0 cursor-grab touch-none text-foreground-subtlest active:cursor-grabbing"
          disabled={rowLocked}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </Button>
      </ControlHintTooltip>
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 truncate text-ui-base text-foreground",
          isCompact ? "font-mono" : null,
        )}
        title={item.text}
      >
        <span className="truncate">{isCompact ? "/compact" : item.text}</span>
      </span>
      {onSendNow ? (
        <Button
          type="button"
          variant="secondary"
          size="default"
          data-icon="inline-start"
          data-testid={testId(TID_V4_QUEUE_ITEM_SEND_NOW, item.queueItemId)}
          data-queue-item-id={item.queueItemId}
          disabled={rowLocked}
          onClick={() =>
            runUserAction({
              input: {
                featureId: "conversation.queue.item",
                action: "send_now",
                trigger: "button",
              },
              operation: () => onSendNow(item.queueItemId),
              completed: { resultSource: "optimistic_projection" },
              failureStage: "queue_send_now",
            })
          }
        >
          <ArrowUpFromLine className="size-3.5" />
          {intl.formatMessage({ id: isCompact ? "chat.queue.runNow" : "chat.queue.sendNow" })}
        </Button>
      ) : null}
      {onEditItem && !isCompact ? (
        <ControlHintTooltip title={intl.formatMessage({ id: "chat.queue.edit" })}>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            data-testid={testId(TID_V4_QUEUE_ITEM_EDIT, item.queueItemId)}
            data-queue-item-id={item.queueItemId}
            aria-label={intl.formatMessage({ id: "chat.queue.edit" })}
            disabled={rowLocked}
            onClick={() => void onEditItem(item.queueItemId)}
          >
            <PencilIcon className="size-4" />
          </Button>
        </ControlHintTooltip>
      ) : null}
      {onDeleteItem ? (
        <ControlHintTooltip title={intl.formatMessage({ id: "chat.queue.remove" })}>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            data-testid={testId(TID_V4_QUEUE_ITEM_DELETE, item.queueItemId)}
            data-queue-item-id={item.queueItemId}
            aria-label={intl.formatMessage({ id: "chat.queue.remove" })}
            disabled={rowLocked}
            onClick={() => onDeleteItem(item.queueItemId)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </ControlHintTooltip>
      ) : null}
    </li>
  );
});
