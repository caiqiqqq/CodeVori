import { AgentBoardCard, boardStatusColors as colors } from "./AgentBoardCard.js";
import { AgentBoardTrackingDialog } from "./AgentBoardTrackingDialog.js";
import { AgentBoardSourcePicker } from "./AgentBoardSourcePicker.js";
import { AgentBoardDetails } from "./AgentBoardDetails.js";
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ChevronDown, Circle, Folder, LayoutGrid, Plus, Search, ListFilter } from "lucide-react";
import { toast } from "@/components/ui/toast.js";
import { Button } from "@/components/ui/button.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useAgentBoardData } from "@/hooks/useAgentBoardData.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { logger } from "@/logger.js";
import {
  BOARD_STATUSES,
  matchesBoardView,
  matchesBoardTracking,
  type BoardItem,
  type BoardView,
} from "./agentBoardModel.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";
const VIEWS: BoardView[] = ["all", "active", "attention", "starred", "archived"];
type Props = {
  workspaceTabs: readonly Omit<WorkspaceTabState, "id" | "kind">[];
  conversationOptions?: BoardConversationOptions;
  onOpenSession(item: BoardItem): void;
  onCreateSession(tab: WorkspaceTabState): void;
};
export function AgentBoardPanel({ workspaceTabs, ...props }: Props) {
  const tabs = useMemo(
    () =>
      workspaceTabs.map((tab) => ({
        ...tab,
        kind: "workspace" as const,
        id: tab.workspaceIdentity?.trim() || tab.workspacePath,
      })),
    [workspaceTabs],
  );
  const data = useAgentBoardData(tabs);
  return <AgentBoardView {...props} {...data} />;
}
export function AgentBoardView({
  projects,
  items,
  mutate,
  refresh,
  loading,
  error,
  onOpenSession,
  onCreateSession,
  conversationOptions,
  canCreateSession,
  workTasks,
}: Omit<Props, "workspaceTabs"> & ReturnType<typeof useAgentBoardData>) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const preferences = useStore(agentBoardStore);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const realProjects = projects.filter((p) => p.tabs[0]?.workspacePurpose !== "conversation");
  const trackedItems = useMemo(
    () => items.filter((item) => matchesBoardTracking(item, preferences.tracking)),
    [items, preferences.tracking],
  );
  const scopeItems = useMemo(
    () =>
      trackedItems.filter((item) =>
        preferences.category === "work-tasks"
          ? item.kind === "work-task"
          : preferences.category !== "standalone" ||
            (item.kind !== "work-task" && item.workspacePurpose === "conversation"),
      ),
    [trackedItems, preferences.category],
  );
  const groupedProjects = realProjects.filter((p) =>
    scopeItems.some((item) => item.projectKey === p.key),
  );
  const selected = items.find((item) => item.key === selectedKey);
  const project = projects.find((p) => p.key === preferences.project);
  const agents = [...new Set(trackedItems.map((item) => item.agent))].sort();
  const filtered = useMemo(
    () =>
      scopeItems.filter(
        (item) =>
          matchesBoardView(item, preferences.view) &&
          (!project || item.projectKey === project.key) &&
          (preferences.agent === "all" || item.agent === preferences.agent) &&
          `${item.title} ${item.summary ?? ""} ${item.agent} ${projects.find((p) => p.key === item.projectKey)?.label ?? ""} ${item.workspacePath}`
            .toLocaleLowerCase()
            .includes(preferences.search.trim().toLocaleLowerCase()),
      ),
    [scopeItems, preferences.view, preferences.agent, preferences.search, project, projects],
  );
  const byStatus =
    preferences.group === "status" ||
    Boolean(project) ||
    preferences.category !== "all" ||
    groupedProjects.length > 6;
  const columns = byStatus
    ? BOARD_STATUSES.filter(
        (status) =>
          (status !== "todo" && status !== "review") ||
          scopeItems.some((item) => item.kind === "work-task"),
      ).map((status) => ({
        key: status,
        label: t(`status.${status}`),
        items: filtered.filter((item) => item.status === status),
      }))
    : [
        ...(scopeItems.some((item) => item.kind === "work-task")
          ? [
              {
                key: "work-tasks",
                label: t("workTasks"),
                items: filtered.filter((item) => item.kind === "work-task"),
              },
            ]
          : []),
        ...(scopeItems.some((item) => item.workspacePurpose === "conversation")
          ? [
              {
                key: "standalone",
                label: t("standalone"),
                items: filtered.filter((item) => item.workspacePurpose === "conversation"),
              },
            ]
          : []),
        ...groupedProjects.map((p) => ({
          key: p.key,
          label: p.label,
          items: filtered.filter(
            (item) =>
              item.kind !== "work-task" &&
              item.workspacePurpose !== "conversation" &&
              item.projectKey === p.key,
          ),
        })),
      ];
  const run = async (item: BoardItem, action: Parameters<typeof mutate>[1]) => {
    setBusy(true);
    try {
      await mutate(item, action);
    } catch (error) {
      logger.warn("[agent-board] 会话操作失败", { action, error });
      toast(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-ui-base"
      data-testid="agent-board"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid className="size-5 text-brand" />
            <h1 className="text-ui-xl font-semibold">{t("title")}</h1>
            <span className="rounded-md bg-surface px-2 text-ui-caption text-foreground-subtle">
              {trackedItems.filter((i) => !i.archived).length}
            </span>
          </div>
          <p className="mt-1 text-ui-caption text-foreground-subtle">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setManaging(true)}>
            <ListFilter className="size-4" />
            {t("manageTracking")}
          </Button>
          <Button
            onClick={() => {
              setCreating(true);
              preferences.setPickerOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("newSession")}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <Button variant="outline" onClick={() => preferences.setPickerOpen(true)}>
          <Folder className="size-4" />
          <span className="max-w-40 truncate">
            {preferences.category === "work-tasks"
              ? t("workTasks")
              : preferences.category === "standalone"
                ? t("standalone")
                : (project?.label ?? t("allProjects"))}
          </span>
          <ChevronDown className="size-3" />
        </Button>
        <label className="flex min-w-36 flex-1 items-center gap-2 rounded-lg border border-border bg-input px-3">
          <Search className="size-4 shrink-0 text-foreground-subtle" />
          <input
            aria-label={t("search")}
            placeholder={t("search")}
            className="h-9 w-full min-w-0 bg-transparent text-mobile-input-safe outline-none md:text-ui-base"
            value={preferences.search}
            onChange={(e) => preferences.setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label={t("agent")}
          value={preferences.agent}
          onChange={(e) => preferences.setAgent(e.target.value)}
          className="h-9 max-w-36 rounded-lg border border-border bg-input px-2 text-ui-base"
        >
          <option value="all">{t("allAgents")}</option>
          {agents.map((agent) => (
            <option key={agent}>{agent}</option>
          ))}
        </select>
        <select
          aria-label={t("group")}
          disabled={
            Boolean(project) || preferences.category !== "all" || groupedProjects.length > 6
          }
          value={byStatus ? "status" : "project"}
          onChange={(e) => preferences.setGroup(e.target.value as "project" | "status")}
          className="h-9 rounded-lg border border-border bg-input px-2 text-ui-base disabled:opacity-60"
        >
          <option value="project">{t("groupProject")}</option>
          <option value="status">{t("groupStatus")}</option>
        </select>
      </div>
      <div
        role="tablist"
        aria-label={t("view")}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2 md:px-6"
      >
        {VIEWS.map((view) => (
          <Button
            key={view}
            role="tab"
            aria-selected={view === preferences.view}
            variant={view === preferences.view ? "secondary" : "ghost"}
            onClick={() => preferences.setView(view)}
          >
            {t(`view.${view}`)}
            <span className="text-ui-caption text-foreground-subtle">
              {
                scopeItems.filter(
                  (i) => matchesBoardView(i, view) && (!project || i.projectKey === project.key),
                ).length
              }
            </span>
          </Button>
        ))}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-3 px-6 py-2 text-ui-caption text-destructive"
        >
          {t("loadFailed")}
          <Button variant="ghost" onClick={() => void refresh()}>
            {t("refresh")}
          </Button>
        </div>
      ) : null}
      {loading && scopeItems.length === 0 ? (
        <p role="status" className="p-6 text-foreground-subtle">
          {t("loading")}
        </p>
      ) : null}
      {!loading && filtered.length === 0 ? (
        <div className="px-6 pt-6 text-foreground-subtle" role="status">
          {t("empty")}
        </div>
      ) : null}
      <div
        className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 py-5 md:px-6"
        data-testid="agent-board-columns"
      >
        {columns.map((column) => (
          <section
            key={column.key}
            className="flex min-h-0 w-72 shrink-0 flex-col md:flex-1 md:basis-60 md:min-w-60"
            data-board-column={column.key}
          >
            <h2 className="mb-3 flex items-center gap-2 px-1 font-medium">
              <Circle
                className={`size-3 ${byStatus ? colors[column.key as keyof typeof colors] : "text-foreground-subtle"}`}
              />
              <span className="truncate">{column.label}</span>
              <span className="ml-auto text-ui-caption text-foreground-subtlest">
                {column.items.length}
              </span>
            </h2>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
              {column.items.map((item) => (
                <AgentBoardCard
                  key={item.key}
                  item={item}
                  projectLabel={projects.find((p) => p.key === item.projectKey)?.label}
                  busy={busy}
                  onOpen={() => setSelectedKey(item.key)}
                  onPin={() => void run(item, "pin")}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {preferences.pickerOpen ? (
        <AgentBoardSourcePicker
          projects={projects}
          creating={creating}
          canCreateSession={canCreateSession}
          onCreateSession={onCreateSession}
          onClose={() => {
            preferences.setPickerOpen(false);
            setCreating(false);
          }}
        />
      ) : null}
      {managing ? (
        <AgentBoardTrackingDialog
          projects={projects}
          items={items}
          tracking={preferences.tracking}
          onSave={preferences.setTracking}
          onClose={() => setManaging(false)}
        />
      ) : null}
      <AgentBoardDetails
        selected={selected}
        workTasks={workTasks}
        projects={projects}
        busy={busy}
        run={run}
        options={conversationOptions}
        onClose={() => setSelectedKey(null)}
        onOpenSession={onOpenSession}
      />
    </section>
  );
}
