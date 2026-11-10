import { CircleDot, GitFork, GitPullRequest, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useRepositoryIssueCounts } from "@/hooks/useRepositoryIssueCounts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function RepositorySidebarButton({
  projects,
  projectsLoading = false,
  active = false,
  onClick,
}: {
  projects: Parameters<typeof useRepositoryIssueCounts>[0];
  projectsLoading?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { count, mergeRequestCount, loading, stale, partial } = useRepositoryIssueCounts(projects);
  const available = !projectsLoading && count !== null;
  // 只有已知的正数才表示有待处理议题；加载、失败或过期的 0 不应产生侧栏提醒。
  const showPending = available && count > 0;
  const showMergeRequests = !projectsLoading && mergeRequestCount !== null && mergeRequestCount > 0;
  const title = intl.formatMessage({ id: "repositoryPanel.title" });
  const summary = intl.formatMessage(
    {
      id: available
        ? partial
          ? "repositoryPanel.sidebar.partial"
          : stale
            ? "repositoryPanel.sidebar.stale"
            : "repositoryPanel.sidebar.pending"
        : loading || projectsLoading
          ? "repositoryPanel.sidebar.loading"
          : "repositoryPanel.sidebar.unavailable",
    },
    { count: count ?? 0 },
  );
  const mergeRequestSummary = showMergeRequests
    ? intl.formatMessage(
        { id: "repositoryPanel.sidebar.mergeRequests" },
        { count: mergeRequestCount },
      )
    : "";
  const description = mergeRequestSummary ? `${summary} · ${mergeRequestSummary}` : summary;
  return (
    <ControlHintTooltip title={description}>
      <Button
        variant="ghost"
        onClick={onClick}
        data-icon="inline-start"
        data-testid="repository-sidebar-open"
        size="lg"
        aria-label={title}
        aria-description={description}
        aria-pressed={active}
        className={cn(
          "w-full min-w-0 justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground",
          active && "bg-selected text-foreground",
        )}
      >
        <GitFork className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {showPending ? (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center gap-1 text-ui-xs tabular-nums text-warning"
          >
            <CircleDot data-testid="repository-sidebar-issue" className="size-3.5!" />
            <span data-testid="repository-sidebar-count">{count > 99 ? "99+" : count}</span>
          </span>
        ) : null}
        {showMergeRequests ? (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center gap-1 text-ui-xs tabular-nums text-icon-blue"
          >
            <GitPullRequest data-testid="repository-sidebar-merge-request" className="size-3.5!" />
            <span data-testid="repository-sidebar-merge-request-count">
              {mergeRequestCount > 99 ? "99+" : mergeRequestCount}
            </span>
          </span>
        ) : null}
        {(showPending || showMergeRequests) && (stale || partial) ? (
          <TriangleAlert
            aria-hidden="true"
            data-testid="repository-sidebar-stale"
            className="size-3! shrink-0 text-warning"
          />
        ) : null}
      </Button>
    </ControlHintTooltip>
  );
}
