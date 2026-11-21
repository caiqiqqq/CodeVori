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
  return <Button {...props} data-board-view={view} />;
}
