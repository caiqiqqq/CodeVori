import { GitFork, TriangleAlert } from "lucide-react";
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
  const { count, loading, stale } = useRepositoryIssueCounts(projects);
  const available = !projectsLoading && count !== null;
  const title = intl.formatMessage({ id: "repositoryPanel.title" });
  const summary = intl.formatMessage(
    {
      id: available
        ? stale
          ? "repositoryPanel.sidebar.stale"
          : "repositoryPanel.sidebar.pending"
        : loading || projectsLoading
          ? "repositoryPanel.sidebar.loading"
          : "repositoryPanel.sidebar.unavailable",
    },
    { count: count ?? 0 },
  );
  return (
    <ControlHintTooltip title={summary}>
      <Button
        variant="ghost"
        onClick={onClick}
        data-icon="inline-start"
        data-testid="repository-sidebar-open"
        size="lg"
        aria-label={title}
        aria-description={summary}
        aria-pressed={active}
        className={cn(
          "w-full min-w-0 justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground",
          active && "bg-selected text-foreground",
        )}
      >
        <GitFork className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {!available || count > 0 || stale ? (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center gap-1 text-ui-xs tabular-nums text-warning"
          >
            {stale ? (
              <TriangleAlert data-testid="repository-sidebar-stale" className="size-3!" />
            ) : null}
            {!available || count > 0 ? (
              <span data-testid="repository-sidebar-count">
                {available ? (count > 99 ? "99+" : count) : "—"}
              </span>
            ) : null}
          </span>
        ) : null}
      </Button>
    </ControlHintTooltip>
  );
}
