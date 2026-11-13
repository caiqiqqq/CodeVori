/* eslint-disable max-lines -- 看板筛选、分组、拖动和详情共用同一份会话投影与选择状态。 */
import { BoardViewTab, boardViews } from "./AgentBoardViewTab.js";
import { AgentBoardStatusOrder } from "./AgentBoardStatusOrder.js";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AgentBoardGroups } from "./AgentBoardGroups.js";
import { AgentBoardTrackingDialog } from "./AgentBoardTrackingDialog.js";
import { AgentBoardSourcePicker } from "./AgentBoardSourcePicker.js";
import { AgentBoardDetails } from "./AgentBoardDetails.js";
import { WorkTaskCreationEditor } from "@/work-tasks/WorkTaskCreationEditor.js";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ChevronDown,
  Folder,
  Grid2X2,
  LayoutGrid,
  List,
  Plus,
  Search,
  ListFilter,
} from "lucide-react";
import { toast } from "@/components/ui/toast.js";
import { Button } from "@/components/ui/button.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useAgentBoardData } from "@/hooks/useAgentBoardData.js";
import { useAgentBoardNotificationSelection } from "./useAgentBoardNotificationSelection.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { logger } from "@/logger.js";
import {
  boardAgentLabel,
  boardEntityKey,
  boardDisplayStatus,
  boardHasUnreadResult,
  canStageBoardItem,
  isBoardItemStaged,
  matchesBoardView,
  matchesBoardTracking,
  boardWorkspaceKey,
  type BoardItem,
} from "./agentBoardModel.js";
import type { BoardConversationOptions } from "./AgentBoardConversation.js";

import type { AgentBoardWorkspaceTools } from "./AgentBoardTools.js";

const AgentBoardSessionEditor = lazy(() =>
  import("./AgentBoardSessionEditor.js").then((module) => ({
    default: module.AgentBoardSessionEditor,
  })),
);

type Props = {
  workspaceTabs: readonly Omit<WorkspaceTabState, "id" | "kind">[];
  conversationOptions?: BoardConversationOptions;
  workspaceTools?: AgentBoardWorkspaceTools;
  onOpenSession(item: BoardItem): void;
  notificationItemKey?: string;
  onNotificationItemOpened?: () => void;
  onNotificationItemMissing?: () => void;
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
  items: rawItems,
  mutate,
  rename,
  markUnread,
  acknowledgeRead,
  refresh,
  loading,
  error,
  onOpenSession,
  conversationOptions,
  workspaceTools,
  canCreateSession,
  workTasks,
  notificationItemKey,
  onNotificationItemOpened,
  onNotificationItemMissing,
}: Omit<Props, "workspaceTabs"> & ReturnType<typeof useAgentBoardData>) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const preferences = useStore(agentBoardStore);
  const items = useMemo(
    () =>
      rawItems.map((item) => ({
        ...item,
        staged: isBoardItemStaged(item, preferences.stagedItems),
        unread: boardHasUnreadResult(item, preferences.readWorkTaskResults),
      })),
    [rawItems, preferences.stagedItems, preferences.readWorkTaskResults],
  );
  useEffect(
    () => preferences.reconcileStagedItems(rawItems),
    [rawItems, preferences.reconcileStagedItems],
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragging = items.find((item) => item.key === draggingKey);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const toggleStaged = (item: BoardItem) => {
    const current = rawItems.find((row) => row.key === item.key);
    if (current)
      preferences.setItemStaged(current, !isBoardItemStaged(current, preferences.stagedItems));
  };
  const [detailContainer, setDetailContainer] = useState<HTMLElement | null>(null);
  const [selectedKey, setSelectedKey] = useAgentBoardNotificationSelection({
    rawItems,
    loading,
    error,
    notificationItemKey,
    acknowledgeRead,
    onNotificationItemOpened,
    onNotificationItemMissing,
  });
  const [busy, setBusy] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [creatingWorkTask, setCreatingWorkTask] = useState(false);
  const [managing, setManaging] = useState(false);
  const realProjects = projects.filter((p) => p.tabs[0]?.workspacePurpose !== "conversation");
  const hasSessionProject = projects.some((p) => p.tabs.some(canCreateSession));
  const workTaskProjects = workTasks.projectTabs.filter(
    (tab) => workTasks.forScope(tab).executable,
  );
  const selectedWorkTaskProject =
    workTaskProjects.find((tab) =>
      projects.some(
        (p) =>
          p.key === preferences.project &&
          p.tabs.some((t) => boardWorkspaceKey(t) === boardWorkspaceKey(tab)),
      ),
    ) ?? workTaskProjects[0];
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
    scopeItems.some(
      (item) =>
        item.kind !== "work-task" &&
        item.workspacePurpose !== "conversation" &&
        item.projectKey === p.key,
    ),
  );
  const selected = items.find((item) => item.key === selectedKey);
  const project = projects.find((p) => p.key === preferences.project);
  const agents = [
    ...new Map(trackedItems.map((item) => [item.agent, boardAgentLabel(item)])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
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
    preferences.view === "staged" ||
    Boolean(project) ||
    preferences.category !== "all" ||
    groupedProjects.length > 6;
  const columns = byStatus
    ? preferences.statusOrder
        .filter((status) =>
          ["active", "completed", "failed", "attention", "staged"].includes(preferences.view)
            ? (status === "staged" && (preferences.view === "staged" || Boolean(dragging))) ||
              filtered.some((item) => boardDisplayStatus(item) === status)
            : true,
        )
        .map((status) => ({
          key: status,
          label: t(`status.${status}`),
          items: filtered.filter((item) => boardDisplayStatus(item) === status),
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
  const runRename = async (item: BoardItem, title: string) => {
    const current = rawItems.find((row) => row.key === item.key);
    if (!current) throw new Error("Session is no longer available");
    setBusy(true);
    try {
      await rename(current, title);
    } finally {
      setBusy(false);
    }
  };
  const runMarkUnread = async (item: BoardItem) => {
    const current = rawItems.find((row) => row.key === item.key);
    if (!current) return;
    setBusy(true);
    try {
      await markUnread(current);
    } catch (error) {
      logger.warn("[agent-board] 标记会话未读失败", { error });
      toast(intl.formatMessage({ id: "taskList.markAsUnreadFailed" }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DndContext
      sensors={sensors}
      // 卡片大于顶部标签，按指针位置判定投放，避免项目分组拖到标签时被矩形面积过滤。
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setDraggingKey(String(active.id))}
      onDragCancel={() => setDraggingKey(null)}
      onDragEnd={({ active, over }) => {
        setDraggingKey(null);
        if (!over?.data.current?.boardStaging) return;
        // 拖动期间会话可能重新运行，必须用最新 Host 投影验证，不能使用起拖时的卡片。
        const item = rawItems.find((row) => row.key === active.id);
        if (item && canStageBoardItem(item)) preferences.setItemStaged(item, true);
      }}
    >
      <section
        ref={setDetailContainer}
        className="relative flex h-full min-h-0 min-w-0 flex-col bg-background text-ui-base text-foreground"
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
            <div
              role="group"
              aria-label={t("layoutMode")}
              className="inline-flex items-center rounded-lg border border-border bg-input p-0.5"
            >
              {(["cards", "compact", "list"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  size="sm"
                  aria-pressed={preferences.layoutMode === mode}
                  title={t("layoutMode." + mode)}
                  className={
                    preferences.layoutMode === mode
                      ? "border border-brand bg-brand font-semibold text-foreground-inverse shadow-sm hover:bg-brand hover:text-foreground-inverse"
                      : "text-foreground-subtle"
                  }
                  onClick={() => preferences.setLayoutMode(mode)}
                >
                  {mode === "list" ? (
                    <List className="size-4" />
                  ) : mode === "compact" ? (
                    <Grid2X2 className="size-4" />
                  ) : (
                    <LayoutGrid className="size-4" />
                  )}
                  <span>{t("layoutMode." + mode)}</span>
                </Button>
              ))}
            </div>
            <AgentBoardStatusOrder />
            <Button variant="outline" onClick={() => setManaging(true)}>
              <ListFilter className="size-4" />
              {t("manageTracking")}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedWorkTaskProject || workTasks.loading || workTasks.busy}
              onClick={() => setCreatingWorkTask(true)}
              data-testid="agent-board-new-work-task"
            >
              <Plus className="size-4" />
              {t("newWorkTask")}
            </Button>
            <Button
              disabled={!hasSessionProject}
              onClick={() => setCreatingSession(true)}
              data-testid="agent-board-new-session"
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
            {agents.map(([agent, label]) => (
              <option key={agent} value={agent}>
                {label}
              </option>
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
          {boardViews(preferences.statusOrder).map((view) => (
            <BoardViewTab
              key={view}
              view={view}
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
            </BoardViewTab>
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
        <AgentBoardGroups
          columns={columns}
          layoutMode={preferences.layoutMode}
          byStatus={byStatus}
          projects={projects}
          busy={busy}
          onOpen={(item) => {
            setSelectedKey(item.key);
            if (item.kind === "work-task") preferences.markWorkTaskResultRead(item);
            else
              void acknowledgeRead(item).catch((error: unknown) => {
                logger.warn("[agent-board] 确认结果已读失败", { error });
                toast(t("actionFailed"));
              });
          }}
          onOpenSession={onOpenSession}
          onArchive={(item) => void run(item, "archive")}
          onStage={toggleStaged}
          onRename={runRename}
          onMarkUnread={(item) => void runMarkUnread(item)}
        />
        {preferences.pickerOpen ? (
          <AgentBoardSourcePicker
            projects={projects}
            onClose={() => {
              preferences.setPickerOpen(false);
            }}
          />
        ) : null}
        {creatingSession ? (
          <Suspense fallback={null}>
            <AgentBoardSessionEditor
              projects={projects}
              initialProjectKey={preferences.project}
              canCreateSession={canCreateSession}
              options={conversationOptions}
              onClose={() => setCreatingSession(false)}
              onAccepted={(kind, id, target) => {
                preferences.revealCreatedSession({
                  kind,
                  key: boardEntityKey(target.tab, kind, id),
                  projectKey: target.project.key,
                  workspacePurpose: target.tab.workspacePurpose,
                });
                setCreatingSession(false);
                void refresh().catch((error: unknown) =>
                  logger.warn("[agent-board] 新会话列表刷新失败", { error }),
                );
              }}
            />
          </Suspense>
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
        {creatingWorkTask && selectedWorkTaskProject ? (
          <WorkTaskCreationEditor
            scope={selectedWorkTaskProject}
            projects={workTaskProjects}
            panel={workTasks}
            onClose={() => setCreatingWorkTask(false)}
            onCreated={(task) =>
              preferences.revealCreatedWorkTask({
                kind: "work-task",
                key: boardEntityKey(task, "work-task", task.id),
                projectKey: boardWorkspaceKey(task),
                workspacePurpose: undefined,
              })
            }
          />
        ) : null}
        <AgentBoardDetails
          selected={selected}
          workTasks={workTasks}
          projects={projects}
          busy={busy}
          run={run}
          options={conversationOptions}
          workspaceTools={workspaceTools}
          container={detailContainer}
          onClose={() => setSelectedKey(null)}
          onOpenSession={onOpenSession}
          onStage={toggleStaged}
          onRename={runRename}
          onMarkUnread={(item) => void runMarkUnread(item)}
        />
      </section>
      <DragOverlay>
        {dragging ? (
          <div className="max-w-72 rounded-xl border border-brand bg-card p-4 text-foreground shadow-lg">
            {dragging.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
