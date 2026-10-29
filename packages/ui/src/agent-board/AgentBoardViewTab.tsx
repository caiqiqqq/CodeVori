import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button.js";
import type { BoardDisplayStatus, BoardView } from "./agentBoardModel.js";

export function boardViews(statusOrder: readonly BoardDisplayStatus[]): BoardView[] {
  return [
    "all",
    ...statusOrder.map(
      (status): BoardView =>
        status === "running" ? "active" : status === "error" ? "failed" : status,
    ),
    "archived",
  ];
}

export function BoardViewTab({
  view,
  ...props
}: React.ComponentProps<typeof Button> & { view: BoardView }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `view:${view}`,
    disabled: view !== "staged",
    data: { boardStaging: true },
  });
  return (
    <Button {...props} ref={setNodeRef} className={isOver ? "ring-2 ring-brand" : undefined} />
  );
}
