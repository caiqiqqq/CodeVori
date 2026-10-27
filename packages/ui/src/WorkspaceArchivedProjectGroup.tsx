import { useId, useState, type ReactNode } from "react";
import { ChevronRight, Cloud, Folder } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WorkspaceArchivedProjectGroup({
  workspaceKey,
  workspacePath,
  label,
  isRemote,
  count,
  children,
}: {
  workspaceKey: string;
  workspacePath: string;
  label: string;
  isRemote: boolean;
  count: number;
  children: ReactNode;
}) {
  const { intl, locale } = useZCodeIntl();
  const contentId = useId();
  // 归档是按项目浏览的历史；默认折叠，展开意图只属于该 identity 的本地 UI。
  const [expanded, setExpanded] = useState(false);
  const Icon = isRemote ? Cloud : Folder;
  return (
    <section
      data-testid="archive-project-group"
      className="min-w-0 rounded-xl border border-border p-2"
    >
      <h3 className="text-ui-base font-semibold text-foreground">
        <button
          type="button"
          data-workspace-key={workspaceKey}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-ring"
          title={workspacePath}
        >
          <ChevronRight
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
          <span
            data-testid="archive-project-count"
            className="shrink-0 text-ui-sm font-normal text-foreground-subtle"
          >
            {count.toLocaleString(locale)}
          </span>
        </button>
      </h3>
      <div className="mx-2.5 mt-1 mb-2 space-y-1 text-ui-sm text-foreground-subtle">
        <p>
          {intl.formatMessage({
            id: isRemote ? "taskList.archiveRemoteProject" : "taskList.archiveLocalProject",
          })}
        </p>
        <p data-testid="archive-project-path" className="font-mono wrap-anywhere">
          {workspacePath}
        </p>
      </div>
      <div id={contentId} hidden={!expanded}>
        {expanded ? <ul className="space-y-1 border-t border-border pt-2">{children}</ul> : null}
      </div>
    </section>
  );
}
