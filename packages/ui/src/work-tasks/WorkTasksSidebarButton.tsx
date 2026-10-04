import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { CircleCheck, ListTodo, Play } from "lucide-react";
import type { WorkTaskScope } from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { countWorkTasks, workTaskSidebarScopes } from "@/lib/workTaskSidebarCounts.js";

interface CountProjection {
  running: number | null;
  done: number | null;
  loading: boolean;
}

function ProjectCounts({
  scope,
  scopeKey,
  onChange,
}: {
  scope: WorkTaskScope;
  scopeKey: string;
  onChange(key: string, projection: CountProjection | null): void;
}) {
  const { board, loading, error } = useWorkTasks(scope, false);
  const counts = board && !loading && !error ? countWorkTasks(board.tasks) : null;
  const running = counts?.running ?? null;
  const done = counts?.done ?? null;
  // 只发布计数投影；服务切换时在绘制前撤销旧数量，不复制任务或执行状态。
  useLayoutEffect(() => {
    onChange(scopeKey, { running, done, loading });
  }, [scopeKey, onChange, running, done, loading]);
  useLayoutEffect(() => () => onChange(scopeKey, null), [scopeKey, onChange]);
  return null;
}

export function WorkTasksSidebarButton({
  projects,
  active = false,
  onClick,
}: {
  projects: Parameters<typeof workTaskSidebarScopes>[0];
  active?: boolean;
  onClick?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const scopes = useMemo(() => workTaskSidebarScopes(projects), [projects]);
  const [projections, setProjections] = useState<Record<string, CountProjection>>({});
  const onChange = useCallback((key: string, projection: CountProjection | null) => {
    setProjections((previous) => {
      if (!projection) {
        if (!(key in previous)) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      }
      const old = previous[key];
      if (
        old?.running === projection.running &&
        old?.done === projection.done &&
        old?.loading === projection.loading
      )
        return previous;
      return { ...previous, [key]: projection };
    });
  }, []);
  let running = 0;
  let done = 0;
  let available = true;
  let loading = false;
  for (const { key } of scopes) {
    const projection = projections[key];
    loading ||= !projection || projection.loading;
    if (projection?.running == null || projection.done == null) available = false;
    else {
      running += projection.running;
      done += projection.done;
    }
  }
  const title = intl.formatMessage({ id: "workTasks.title" });
  const summary = intl.formatMessage(
    {
      id: available
        ? "workTasks.sidebar.summary"
        : loading
          ? "workTasks.sidebar.loading"
          : "workTasks.sidebar.unavailable",
    },
    { running, done },
  );
  return (
    <>
      {scopes.map(({ key, scope }) => (
        <ProjectCounts key={key} scopeKey={key} scope={scope} onChange={onChange} />
      ))}
      <ControlHintTooltip title={summary}>
        <Button
          variant="ghost"
          onClick={onClick}
          data-icon="inline-start"
          data-testid="work-tasks-sidebar-open"
          size="lg"
          aria-label={title}
          aria-description={summary}
          aria-pressed={active}
          className={cn(
            "w-full min-w-0 justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground",
            active && "bg-selected text-foreground",
          )}
        >
          <ListTodo className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center gap-2 text-ui-xs tabular-nums"
          >
            <span
              data-testid="work-tasks-sidebar-running"
              className="flex items-center gap-1 text-icon-blue"
            >
              <Play className="size-3!" />
              {available ? running : "-"}
            </span>
            <span
              data-testid="work-tasks-sidebar-done"
              className="flex items-center gap-1 text-success"
            >
              <CircleCheck className="size-3!" />
              {available ? done : "-"}
            </span>
          </span>
        </Button>
      </ControlHintTooltip>
    </>
  );
}
