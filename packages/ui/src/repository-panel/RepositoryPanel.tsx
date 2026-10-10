import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GitFork, Plus, RotateCw, Settings } from "lucide-react";
import type { ForgeItem, ForgeItemRequest, ForgeTargetRequest } from "@zcode/shared";
import { useRepositoryPanel } from "@/hooks/useRepositoryPanel.js";
import { useRepositoryRemote } from "@/hooks/useRepositoryRemote.js";
import { useRepositoryTaskItems } from "@/hooks/useRepositoryTaskItems.js";
import { useRepositoryTask } from "@/hooks/useRepositoryTask.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { safeRepositoryExternalUrl } from "@/lib/forgePanel.js";
import { getPathLeaf } from "@/lib/path.js";
import type { RepositoryWorkspaceTab } from "@/lib/repositoryWorkspaces.js";
import { buildWorkspaceSessionKey } from "@/lib/remoteWorkspaceHistory.js";
import type { WorktreeProjectGroup } from "@/lib/worktreeProjectGrouping.js";
import { logger } from "@/logger.js";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { workTaskNavigationStore } from "@/store/workTaskNavigationStore.js";
import { WorkTaskEditor } from "@/work-tasks/WorkTaskEditor.js";
import type { Theme } from "@/useTheme.js";
import { RepositoryToolbar, type RepositoryFilters } from "./RepositoryToolbar.js";
import { RepositoryItemDetail } from "./RepositoryItemDetail.js";
import { RepositoryItemRow } from "./RepositoryItemRow.js";
import { NewIssueDialog } from "./NewIssueDialog.js";
import { RepositoryProjectSelector } from "./RepositoryProjectSelector.js";
import {
  RepositoryError,
  RepositoryExternalButton,
  RepositoryIconButton,
  RepositoryLoading,
  useRepositoryMessages,
} from "./RepositoryParts.js";

interface RepositoryPanelProps {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  active?: boolean;
  theme: Theme;
  workspaceTabs?: readonly RepositoryWorkspaceTab[];
  onOpenTasks?: (target: { workspacePath: string; workspaceIdentity?: string }) => void;
  onSelectProject?: (target: { workspacePath: string; workspaceIdentity?: string }) => void;
}

export function RepositoryPanel(props: RepositoryPanelProps) {
  const projectTabs = useMemo<WorkspaceTabState[]>(
    () =>
      (props.workspaceTabs ?? [])
        .filter((tab) => tab.workspacePurpose !== "conversation")
        .map((tab) => ({ ...tab, kind: "workspace", id: buildWorkspaceSessionKey(tab) })),
    [props.workspaceTabs],
  );
  // 关系查询属于项目列表，放在切换时重建的仓库内容外，避免每次选择都重新加载。
  const projects = useWorktreeProjectGroupsResolution(projectTabs);
  // 草稿筛选属于当前 workspace，切换项目时立即换 owner，不能先显示旧仓库再等待 effect 清理。
  return (
    <RepositoryPanelContent
      key={`${props.workspaceIdentity?.trim() || props.workspacePath}:${props.remoteSessionId ?? "local"}`}
      {...props}
      projectGroups={projects.groups}
      projectsLoading={projects.loading}
    />
  );
}

interface RepositoryPanelContentProps extends RepositoryPanelProps {
  projectGroups: readonly WorktreeProjectGroup[];
  projectsLoading: boolean;
}

function RepositoryPanelContent({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  active = true,
  theme,
  workspaceTabs,
  onSelectProject,
  onOpenTasks,
  projectGroups,
  projectsLoading,
}: RepositoryPanelContentProps) {
  const t = useRepositoryMessages();
  const platform = usePlatform();
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const { remoteName, selectRemote } = useRepositoryRemote(workspacePath, workspaceIdentity);
  const [filters, setFilters] = useState<RepositoryFilters>({
    kind: "issue",
    state: "open",
    search: "",
    sort: "newest",
    labels: [],
    page: 1,
  });
  const panel = useRepositoryPanel(
    { workspacePath, workspaceIdentity, remoteSessionId },
    { ...filters, remoteName },
    active,
  );
  const task = useRepositoryTask(
    { workspacePath, workspaceIdentity, remoteSessionId },
    panel.target,
  );
  const [selection, setSelection] = useState<{
    target: ForgeTargetRequest;
    kind: ForgeItem["kind"];
    number: number;
  } | null>(null);
  const [newIssueTarget, setNewIssueTarget] = useState<ForgeTargetRequest | null>(null);
  const repo = panel.repository?.repository;
  const selectionRequest = useMemo<ForgeItemRequest | null>(
    () =>
      selection && selection.target === panel.target
        ? { ...selection.target, kind: selection.kind, number: selection.number }
        : null,
    [selection, panel.target],
  );
  const openExternal = useCallback(
    (url: string) => {
      const safeUrl = safeRepositoryExternalUrl(url);
      if (safeUrl)
        void Promise.resolve(platform.openExternal(safeUrl)).catch(() =>
          logger.warn("[RepositoryPanel] 打开仓库链接失败"),
        );
    },
    [platform],
  );
  const selectItem = (item: ForgeItem) => {
    if (panel.target) setSelection({ target: panel.target, kind: item.kind, number: item.number });
  };
  const handleItem = (item: ForgeItem, again = false) => {
    if (!repo || !panel.target) return;
    const linked = task.linkedTask(item);
    if (!again && linked && !["failed", "canceled"].includes(linked.status)) {
      workTaskNavigationStore.getState().selectProject(linked);
      workTaskNavigationStore.getState().selectTask(linked, linked.id);
      onOpenTasks?.(linked);
      return;
    }
    void task.prepare(repo, item, again);
  };
  const onFilterChange = (patch: Partial<RepositoryFilters>) =>
    setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const status = panel.repository?.status;
  const data = useRepositoryTaskItems(
    panel.list.data,
    panel.target,
    panel.gitService,
    task.closedItemsKey,
    filters.state,
  );
  return (
    <div
      data-testid="repository-panel"
      aria-busy={panel.discoveryLoading || panel.list.loading}
      className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
    >
      <div className="shrink-0 px-4 pt-4 md:px-6">
        <header className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 basis-full items-center gap-2 md:basis-auto">
            <GitFork className="size-5 shrink-0 text-foreground-subtle" />
            <div className="min-w-0 flex-1">
              {workspaceTabs && onSelectProject ? (
                <RepositoryProjectSelector
                  title={repo?.name ?? getPathLeaf(workspacePath)}
                  workspacePath={workspacePath}
                  workspaceIdentity={workspaceIdentity}
                  projectGroups={projectGroups}
                  projectsLoading={projectsLoading}
                  onSelectProject={onSelectProject}
                />
              ) : (
                <h2 className="break-all text-ui-base font-medium">{repo?.name ?? t("title")}</h2>
              )}
              <p className="break-all text-ui-sm text-foreground-subtle">
                {repo
                  ? `${repo.provider === "github" ? "GitHub" : repo.provider === "gitlab" ? "GitLab" : "Gitea / Forgejo"} · ${repo.accountUsername}`
                  : workspacePath}
              </p>
            </div>
          </div>
          {panel.repository?.remoteNames.length ? (
            <Select
              value={panel.repository.remoteName ?? undefined}
              onValueChange={(name) => {
                selectRemote(name);
                setFilters((current) => ({ ...current, labels: [], page: 1 }));
                setSelection(null);
                setNewIssueTarget(null);
              }}
            >
              <SelectTrigger size="lg" aria-label={t("remote")} className="max-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {panel.repository.remoteNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <RepositoryExternalButton
            url={repo?.url ?? null}
            label={t("openRepository")}
            onOpen={openExternal}
          />
          <RepositoryIconButton
            label={t("refresh")}
            disabled={panel.discoveryLoading || panel.list.loading}
            onClick={panel.refresh}
          >
            <RotateCw className="size-4" />
          </RepositoryIconButton>
          {repo && !selectionRequest ? (
            <Button size="lg" onClick={() => setNewIssueTarget(panel.target)}>
              <Plus className="size-4" />
              {t("newIssue")}
            </Button>
          ) : null}
        </header>
      </div>
      {repo && selectionRequest ? (
        <RepositoryItemDetail
          key={`${repo.key}:${selectionRequest.kind}:${selectionRequest.number}`}
          request={selectionRequest}
          repository={repo}
          gitService={panel.gitService}
          theme={theme}
          active={active}
          onClose={() => setSelection(null)}
          onChanged={panel.refresh}
          onHandle={handleItem}
          handleBusy={task.busy}
          onHandleAgain={(item) => handleItem(item, true)}
          getLinkedTask={task.linkedTask}
          writebackVersion={task.writebackVersion}
          taskError={task.error}
          onOpen={openExternal}
        />
      ) : (
        <>
          {repo ? (
            <div className="shrink-0 px-4 md:px-6">
              <RepositoryToolbar
                provider={repo.provider}
                filters={filters}
                labels={panel.labels}
                onChange={onFilterChange}
              />
            </div>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 [scrollbar-gutter:stable]">
            {task.error ? <RepositoryError error={task.error} /> : null}
            {panel.error ? (
              <RepositoryError error={panel.error} retry={panel.refresh} />
            ) : !repo && panel.discoveryLoading ? (
              <RepositoryLoading />
            ) : !repo && status ? (
              <div className="flex flex-col items-start gap-3 py-8">
                <p className="max-w-xl break-words text-ui-sm text-foreground-subtle">
                  {t(`empty.${status}`, {
                    host: panel.repository?.host ?? "",
                    provider: panel.repository?.provider ?? "",
                  })}
                </p>
                {status === "missing-account" ||
                status === "account-mismatch" ||
                status === "unsupported" ? (
                  panel.isRemoteTarget ? (
                    <p className="max-w-xl text-ui-sm text-foreground-subtle">
                      {t("remoteAccountRequired")}
                    </p>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPendingSettingsSectionIntent("versionControl");
                        openSettingsTab();
                      }}
                    >
                      <Settings className="size-4" />
                      {t("addAccount")}
                    </Button>
                  )
                ) : null}
              </div>
            ) : repo ? (
              <>
                {panel.list.error ? (
                  <RepositoryError error={panel.list.error} retry={panel.refresh} />
                ) : panel.list.loading ? (
                  <RepositoryLoading />
                ) : data ? (
                  <>
                    <div className="flex flex-wrap justify-between gap-2 py-3 text-ui-sm text-foreground-subtle">
                      <span>
                        {data.total !== null
                          ? t("count", { count: data.total })
                          : t("page", { page: filters.page })}
                      </span>
                      {data.incomplete ? <span>{t("incomplete")}</span> : null}
                      {data.total !== null &&
                      data.reachableTotal !== null &&
                      data.total > data.reachableTotal ? (
                        <span>{t("reachableCap", { count: data.reachableTotal })}</span>
                      ) : null}
                    </div>
                    {data.items.length ? (
                      <ul className="flex flex-col gap-1">
                        {data.items.map((item) => (
                          <RepositoryItemRow
                            key={`${item.kind}:${item.number}`}
                            item={item}
                            busy={task.busy || !!task.draft}
                            created={task.isCreated(item)}
                            linkedTask={task.linkedTask(item)}
                            onHandleAgain={() => handleItem(item, true)}
                            onSelect={() => selectItem(item)}
                            onHandle={() => {
                              handleItem(item);
                            }}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="py-8 text-ui-sm text-foreground-subtle">{t("emptyList")}</p>
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          {repo ? (
            <nav
              aria-label={t("pagination")}
              className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4 py-3 text-ui-sm md:px-6"
            >
              <RepositoryIconButton
                label={t("previousPage")}
                disabled={filters.page === 1 || panel.list.loading}
                onClick={() => onFilterChange({ page: filters.page - 1 })}
              >
                <ChevronLeft className="size-4" />
              </RepositoryIconButton>
              <span className="min-w-12 text-center tabular-nums">
                {t("page", { page: filters.page })}
              </span>
              <RepositoryIconButton
                label={t("nextPage")}
                disabled={!data?.hasMore || panel.list.loading}
                onClick={() => onFilterChange({ page: filters.page + 1 })}
              >
                <ChevronRight className="size-4" />
              </RepositoryIconButton>
            </nav>
          ) : null}
        </>
      )}
      {active && task.draft ? (
        <WorkTaskEditor
          key={task.draft.key}
          scope={{ workspacePath, workspaceIdentity, remoteSessionId }}
          task={null}
          initialDraft={task.draft.initialDraft}
          busy={task.busy}
          error={task.error ? t(`error.${task.error}`) : null}
          onClose={task.close}
          onSave={task.create}
        />
      ) : null}
      {repo && panel.target && newIssueTarget === panel.target ? (
        <NewIssueDialog
          open={active}
          repository={repo}
          target={panel.target}
          gitService={panel.gitService}
          theme={theme}
          onOpen={openExternal}
          busy={panel.mutation.busy}
          error={panel.mutation.error}
          onClose={() => setNewIssueTarget(null)}
          onSubmit={async (draft) => {
            const item = await panel.createIssue(draft);
            if (item) {
              setNewIssueTarget(null);
              selectItem(item);
            }
          }}
        />
      ) : null}
    </div>
  );
}
