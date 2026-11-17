import { CircleCheck, LoaderCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  boardAgentLabel,
  boardStatusIndicator,
  matchesBoardTracking,
  type BoardItem,
  type BoardTracking,
} from "./agentBoardModel.js";

export function AgentBoardTrackingItems({
  items,
  tracking,
  onCheckedChange,
}: {
  items: BoardItem[];
  tracking: BoardTracking;
  onCheckedChange(item: BoardItem, checked: boolean): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const rows = (candidates: BoardItem[]) =>
    candidates.map((item) => {
      const status = boardStatusIndicator(item);
      return (
        <label
          key={item.key}
          className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-2 hover:bg-surface-hover"
        >
          <Checkbox
            className="mt-0.5"
            checked={matchesBoardTracking(item, { ...tracking, mode: "custom" })}
            onCheckedChange={(checked) => onCheckedChange(item, checked === true)}
          />
          <span className="min-w-0">
            <span className="line-clamp-2">{item.title || t("untitled")}</span>
            <span className="inline-flex flex-wrap items-center gap-1 text-ui-caption text-foreground-subtle">
              <span>{boardAgentLabel(item)} ·</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                {/* 沿用真实状态，离线或等待不播放运行动画。 */}
                {status === "completed" ? (
                  <CircleCheck aria-hidden="true" className="size-3 shrink-0 text-success" />
                ) : status === "running" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    strokeWidth={3}
                    className={`size-3 shrink-0 text-task-running-indicator ${item.online ? "animate-spin motion-reduce:animate-none" : ""}`}
                  />
                ) : null}
                {t(`status.${status}`)}
              </span>
            </span>
          </span>
        </label>
      );
    });
  return (
    <div className="mt-2 space-y-2">
      {rows(items)}
      {items.length === 0 ? (
        <p className="py-2 text-ui-caption text-foreground-subtle">{t("empty")}</p>
      ) : null}
    </div>
  );
}
