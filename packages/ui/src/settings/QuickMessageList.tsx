import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { QuickMessage } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function MessageRow({
  message,
  selected,
  disabled,
  sortable,
  onSelect,
}: {
  message: QuickMessage;
  selected: boolean;
  disabled: boolean;
  sortable: boolean;
  onSelect: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({
      id: message.id,
      disabled: !sortable || disabled,
    });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-quick-message-row={message.id}
      className={`flex min-w-0 items-center gap-1 rounded-lg px-1 ${selected ? "bg-card-selected" : "hover:bg-surface-hover"}`}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-sm"
        className="touch-none text-foreground-subtle"
        {...attributes}
        {...listeners}
        disabled={!sortable || disabled}
        aria-label={intl.formatMessage({ id: "settings.quickMessages.reorder" })}
      >
        <GripVertical className="size-4" />
      </Button>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-3 text-left text-ui-base"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="w-full truncate font-medium">{message.title}</span>
        <span className="w-full truncate text-ui-caption text-foreground-subtle">
          {message.content}
        </span>
      </button>
    </div>
  );
}

export function QuickMessageList({
  messages,
  selectedId,
  disabled,
  sortable,
  onSelect,
  onReorder,
}: {
  messages: QuickMessage[];
  selectedId?: string;
  disabled: boolean;
  sortable: boolean;
  onSelect: (message: QuickMessage) => void;
  onReorder: (messages: QuickMessage[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!sortable || disabled || !over || active.id === over.id) return;
    const from = messages.findIndex((m) => m.id === active.id),
      to = messages.findIndex((m) => m.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(messages, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={messages.map((m) => m.id)} strategy={verticalListSortingStrategy}>
        <div data-testid="quick-message-list" className="flex flex-col gap-0.5 p-2">
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              selected={message.id === selectedId}
              disabled={disabled}
              sortable={sortable}
              onSelect={() => onSelect(message)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
