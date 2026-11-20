import type { CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Ban,
  GripVertical,
  Plus,
  UserRound,
} from "lucide-react";
import type { WorkTaskWorkflowStage } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { canReorderWorkflowStep, workflowStepHandoff } from "@/lib/taskWorkflowDraft.js";

export function WorkflowStatusIcon({ stage }: { stage: WorkTaskWorkflowStage }) {
  const Icon =
    stage.status === "backlog"
      ? CircleDashed
      : stage.status === "active"
        ? CircleDot
        : stage.status === "review" || stage.status === "done"
          ? CircleCheck
          : stage.status === "blocked"
            ? Ban
            : stage.status === "canceled"
              ? CircleX
              : Circle;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        stage.status === "active"
          ? "text-warning"
          : stage.status === "review" || stage.status === "done"
            ? "text-success"
            : stage.status === "blocked"
              ? "text-destructive"
              : "text-foreground-subtle",
      )}
    />
  );
}
function StepCard({
  stage,
  selected,
  initial,
  busy,
  onSelect,
  onToggle,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  stage: WorkTaskWorkflowStage;
  selected: boolean;
  initial: boolean;
  busy: boolean;
  onSelect(): void;
  onToggle(value: boolean): void;
  onMove(offset: number): void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const t = useWorkTaskMessages();
  const movable = canReorderWorkflowStep(stage);
  const drag = useSortable({ id: stage.id, disabled: busy || !movable });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(drag.transform),
    transition: drag.transition,
  };
  const handoff = workflowStepHandoff(stage);
  return (
    <li
      ref={drag.setNodeRef}
      style={style}
      className={cn(
        "group flex min-w-0 items-start gap-1 rounded-xl border border-border bg-card px-2 py-2.5",
        selected && "border-border-hover bg-selected",
        stage.enabled === false && "border-dashed opacity-60",
        drag.isDragging && "z-10 shadow-md",
      )}
    >
      {movable ? (
        <button
          type="button"
          {...drag.attributes}
          {...drag.listeners}
          disabled={busy}
          aria-label={t("workflow.reorder", { name: stage.name })}
          className="mt-0.5 flex size-5 shrink-0 touch-none items-center justify-center rounded-md text-foreground-subtlest"
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <button
        type="button"
        disabled={busy}
        aria-pressed={selected}
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
        data-testid="workflow-step"
      >
        <span className="flex items-center gap-2 text-ui-base font-medium">
          <WorkflowStatusIcon stage={stage} />
          <span className="truncate">{stage.name || t("workflow.unnamed")}</span>
          {initial ? (
            <span className="text-ui-xs font-normal text-foreground-subtlest">
              {t("workflow.start")}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1 text-ui-sm text-foreground-subtle">
          <UserRound className="size-3" />
          <span className="truncate">
            {stage.enabled === false
              ? t("workflow.excluded")
              : handoff === "none"
                ? t("workflow.keepOwner")
                : handoff === "member"
                  ? stage.owner || t("workflow.member")
                  : t("workflow.agent")}
          </span>
        </span>
      </button>
      {stage.status === "backlog" || stage.status === "blocked" ? (
        <Switch
          // Switch 自带左右 12px 的触摸命中区；留出间距，避免窄屏溢出卡片。
          className="mr-1"
          checked={stage.enabled !== false}
          disabled={busy}
          onCheckedChange={onToggle}
          aria-label={t("workflow.include", { name: stage.name })}
        />
      ) : movable && selected ? (
        <span className="flex flex-col">
          <button
            disabled={busy || !canMoveUp}
            aria-label={t("workflow.moveEarlier")}
            onClick={() => onMove(-1)}
            className="text-foreground-subtle disabled:opacity-25"
          >
            <ArrowUp className="size-3" />
          </button>
          <button
            disabled={busy || !canMoveDown}
            aria-label={t("workflow.moveLater")}
            onClick={() => onMove(1)}
            className="text-foreground-subtle disabled:opacity-25"
          >
            <ArrowDown className="size-3" />
          </button>
        </span>
      ) : null}
    </li>
  );
}
export function WorkflowStepList({
  stages,
  selection,
  initialStageId,
  busy,
  onSelect,
  onChange,
  onAdd,
}: {
  stages: WorkTaskWorkflowStage[];
  selection: string;
  initialStageId?: string;
  busy: boolean;
  onSelect(id: string): void;
  onChange(stages: WorkTaskWorkflowStage[]): void;
  onAdd(): void;
}) {
  const t = useWorkTaskMessages();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const move = (from: number, to: number) => {
    if (
      from < 0 ||
      to < 0 ||
      !stages[from] ||
      !stages[to] ||
      !canReorderWorkflowStep(stages[from]) ||
      !canReorderWorkflowStep(stages[to])
    )
      return;
    const next = [...stages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className="min-w-0 space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id)
            move(
              stages.findIndex((stage) => stage.id === active.id),
              stages.findIndex((stage) => stage.id === over.id),
            );
        }}
      >
        <SortableContext
          items={stages.map((stage) => stage.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2" aria-label={t("workflow.stages")}>
            {stages.map((stage, index) => (
              <StepCard
                key={stage.id}
                stage={stage}
                selected={selection === stage.id}
                initial={stage.id === initialStageId}
                busy={busy}
                onSelect={() => onSelect(stage.id)}
                onToggle={(enabled) =>
                  onChange(
                    stages.map((item) => (item.id === stage.id ? { ...item, enabled } : item)),
                  )
                }
                onMove={(offset) => move(index, index + offset)}
                canMoveUp={index > 0 && canReorderWorkflowStep(stages[index - 1]!)}
                canMoveDown={
                  index < stages.length - 1 && canReorderWorkflowStep(stages[index + 1]!)
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <Button size="sm" variant="outline" disabled={busy || stages.length >= 12} onClick={onAdd}>
        <Plus className="size-3.5" />
        {t("workflow.addStage")}
      </Button>
      <p className="text-ui-sm leading-5 text-foreground-subtle">{t("workflow.orderHelp")}</p>
    </div>
  );
}
