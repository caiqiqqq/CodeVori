import { useMemo, useState } from "react";
import { ChevronDown, Cloud, Folder, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRepositoryIssueCounts } from "@/hooks/useRepositoryIssueCounts.js";
import { cn } from "@/components/lib/utils.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import {
  buildWorkspaceSessionKey,
  hasRemoteWorkspaceIdentity,
} from "@/lib/remoteWorkspaceHistory.js";
import { getRepositoryWorkspaceOptions } from "@/lib/repositoryWorkspaces.js";
import type { WorktreeProjectGroup } from "@/lib/worktreeProjectGrouping.js";
import { Button } from "@/components/ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useRepositoryMessages } from "./RepositoryParts.js";

interface Props {
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  projectGroups: readonly WorktreeProjectGroup[];
  projectsLoading: boolean;
  onSelectProject: (target: { workspacePath: string; workspaceIdentity?: string }) => void;
}

export function RepositoryProjectSelector(props: Props) {
  const t = useRepositoryMessages();
  const [open, setOpen] = useState(false);
  const sessions = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const options = useMemo(
    () =>
      getRepositoryWorkspaceOptions(props.projectGroups, new Set(Object.keys(sessions))).filter(
        (option) =>
          !props.projectsLoading ||
          hasRemoteWorkspaceIdentity(option) ||
          option.disabledReason === "unavailable",
      ),
    [props.projectGroups, props.projectsLoading, sessions],
  );
  const counts = useRepositoryIssueCounts(options);
  const activeKey = buildWorkspaceSessionKey(props);
  const currentGroup = props.projectGroups.find((group) =>
    group.workspaceTabs.some((tab) => buildWorkspaceSessionKey(tab) === activeKey),
  );
  const currentKey = currentGroup ? buildWorkspaceSessionKey(currentGroup.tab) : activeKey;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-label={t("selectProject")}
          aria-expanded={open}
          aria-haspopup="listbox"
          title={props.workspacePath}
          className="-ml-2 h-8 max-w-full justify-start gap-1.5 px-2 text-ui-base font-medium"
        >
          <span className="min-w-0 truncate">{props.title}</span>
          <ChevronDown className="size-3.5 shrink-0 text-foreground-subtle" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-testid="repository-project-picker"
        aria-label={t("selectProject")}
        className="w-96 max-w-[calc(100vw-2rem)] gap-0 rounded-lg border-popover-border bg-menu p-0"
      >
        <Command defaultValue={currentKey} className="rounded-lg bg-menu p-0">
          <CommandInput aria-label={t("searchProjects")} placeholder={t("searchProjects")} />
          <CommandList className="flex max-h-[min(18rem,calc(var(--radix-popover-content-available-height,100dvh)-4rem))] flex-col gap-0.5 p-1">
            {props.projectsLoading ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-3 text-ui-sm text-foreground-subtle"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {t("loading")}
              </div>
            ) : (
              <CommandEmpty>{t("noProjects")}</CommandEmpty>
            )}
            {options.map((option) => {
              const Icon = hasRemoteWorkspaceIdentity(option) ? Cloud : Folder;
              const issueCount = counts.projects.get(option.key);
              const count = issueCount?.count ?? null;
              const loading = issueCount?.loading ?? counts.loading;
              const summary = t(
                count === null
                  ? loading
                    ? "sidebar.loading"
                    : "sidebar.unavailable"
                  : issueCount?.stale
                    ? "sidebar.stale"
                    : "sidebar.pending",
                { count: count ?? 0 },
              );
              const subtitle = [option.workspacePath, option.remoteSubtitle]
                .filter(Boolean)
                .join(" · ");
              return (
                <CommandItem
                  key={option.key}
                  value={option.key}
                  keywords={[option.label, option.workspacePath, option.remoteSubtitle]}
                  disabled={Boolean(option.disabledReason)}
                  data-testid="repository-project-option"
                  data-workspace-key={option.key}
                  data-checked={option.key === currentKey}
                  title={subtitle}
                  className="min-w-0 rounded-md px-2 py-2"
                  onSelect={() => {
                    setOpen(false);
                    props.onSelectProject({
                      workspacePath: option.workspacePath,
                      workspaceIdentity: option.workspaceIdentity,
                    });
                  }}
                >
                  <Icon className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate">{option.label}</span>
                      <span
                        data-testid="repository-project-count"
                        title={summary}
                        aria-label={summary}
                        className={cn(
                          "flex shrink-0 items-center gap-1 text-ui-xs tabular-nums text-foreground-subtle",
                          count !== null && count > 0 && "text-warning",
                        )}
                      >
                        {count === null ? (
                          loading ? (
                            <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                          ) : (
                            "—"
                          )
                        ) : (
                          <>
                            {issueCount?.stale ? (
                              <TriangleAlert aria-hidden="true" className="size-3" />
                            ) : null}
                            {count > 99 ? "99+" : count}
                          </>
                        )}
                      </span>
                    </span>
                    <span className="truncate text-ui-sm text-foreground-subtle">
                      {option.workspacePath}
                    </span>
                    {option.remoteSubtitle ? (
                      <span className="truncate text-ui-sm text-foreground-subtle">
                        {option.remoteSubtitle}
                      </span>
                    ) : null}
                    {option.disabledReason ? (
                      <span className="text-ui-xs text-foreground-subtle">
                        {t(`project.${option.disabledReason}`)}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
