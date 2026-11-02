import { CircleCheck, LoaderCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  boardAgentLabel,
  boardStatusIndicator,
  matchesBoardTracking,
  type BoardItem,
  type BoardProject,
  type BoardTracking,
} from "./agentBoardModel.js";

export function AgentBoardTrackingItems({
  items,
  projects,
  byProject,
  tracking,
  onCheckedChange,
}: {
  items: BoardItem[];
  projects: ReadonlyMap<string, BoardProject>;
  byProject: boolean;
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
  // 待办原先混排，无法辨认项目；按已有身份分组，避免同路径远端项目被合并。
  const groups = new Map<string, BoardItem[]>();
  if (byProject) {
    for (const item of items) {
      const group = groups.get(item.projectKey) ?? [];
      group.push(item);
      groups.set(item.projectKey, group);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {byProject
        ? [...groups].map(([key, candidates]) => (
            <section
              key={key}
              data-testid="tracking-work-task-project"
              data-project-key={key}
              className="min-w-0 rounded-lg border border-border p-2"
            >
              <h3 className="flex min-w-0 items-center gap-2 text-ui-base font-medium">
                <span className="truncate">
                  {projects.get(key)?.label || candidates[0]?.workspacePath || key}
                </span>
                <span className="shrink-0 text-ui-caption text-foreground-subtle">
                  {candidates.length}
                </span>
              </h3>
              <p className="truncate text-ui-caption text-foreground-subtle" title={key}>
                {key}
              </p>
              {rows(candidates)}
            </section>
          ))
        : rows(items)}
      {items.length === 0 ? (
        <p className="py-2 text-ui-caption text-foreground-subtle">{t("empty")}</p>
      ) : null}
    </div>
  );
}
