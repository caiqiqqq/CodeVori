import { useState } from "react";
import { useStore } from "zustand";
import { ArrowDown, ArrowUp, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { BOARD_DISPLAY_STATUSES, type BoardDisplayStatus } from "./agentBoardModel.js";

export function AgentBoardStatusOrder() {
  const [open, setOpen] = useState(false);
  const order = useStore(agentBoardStore, (state) => state.statusOrder);
  const { intl } = useZCodeIntl();
  const t = (name: string) => intl.formatMessage({ id: `agentBoard.${name}` });
  const move = (status: BoardDisplayStatus, offset: number) => {
    const state = agentBoardStore.getState();
    const next = [...state.statusOrder];
    const index = next.indexOf(status);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    state.setStatusOrder(next);
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ArrowDownUp className="size-4" />
        {t("statusOrder")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{t("statusOrder")}</DialogTitle>
          <DialogDescription>{t("statusOrderDescription")}</DialogDescription>
          <ol className="space-y-2" aria-label={t("statusOrder")}>
            {order.map((status, index) => (
              <li key={status} className="flex items-center gap-2" data-board-order={status}>
                <span className="min-w-0 flex-1">{t(`status.${status}`)}</span>
                {([-1, 1] as const).map((offset) => {
                  const Icon = offset < 0 ? ArrowUp : ArrowDown;
                  return (
                    <Button
                      key={offset}
                      variant="ghost"
                      size="icon-sm"
                      disabled={offset < 0 ? index === 0 : index === order.length - 1}
                      aria-label={intl.formatMessage(
                        { id: `agentBoard.${offset < 0 ? "moveStatusUp" : "moveStatusDown"}` },
                        { status: t(`status.${status}`) },
                      )}
                      onClick={() => move(status, offset)}
                    >
                      <Icon className="size-4" />
                    </Button>
                  );
                })}
              </li>
            ))}
          </ol>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => agentBoardStore.getState().setStatusOrder(BOARD_DISPLAY_STATUSES)}
            >
              {t("resetStatusOrder")}
            </Button>
            <Button onClick={() => setOpen(false)}>{t("closeStatusOrder")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
