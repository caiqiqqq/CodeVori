import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button.js";
import type { BoardView } from "./agentBoardModel.js";
export const BOARD_VIEWS: BoardView[] = [
  "all",
  "active",
  "completed",
  "failed",
  "staged",
  "archived",
];

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
