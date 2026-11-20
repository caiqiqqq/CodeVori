import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";
import {
  defaultBoardTracking,
  canStageBoardItem,
  isBoardItemStaged,
  boardDisplayStatus,
  boardHasUnreadResult,
  workTaskResultToken,
  matchesBoardTracking,
  BOARD_DISPLAY_STATUSES,
  DEFAULT_BOARD_WORKFLOW_STATUSES,
  type BoardDisplayStatus,
  type BoardWorkflowStatus,
  type BoardTrackingTarget,
  type BoardItem,
  type BoardStagedItems,
  type BoardTracking,
  type BoardView,
} from "@/agent-board/agentBoardModel.js";
interface Preferences {
  statusOrder: readonly BoardDisplayStatus[];
  workflowStatuses: readonly BoardWorkflowStatus[];
  workflowAssignments: Record<string, string>;
  readWorkTaskResults: Record<string, string>;
  stagedItems: BoardStagedItems;
  project: string | null;
  pinnedProjects: string[] | null;
  view: BoardView;
  group: "project" | "status" | "workflow";
  agent: string;
  search: string;
  tracking: BoardTracking;
  category: "all" | "standalone" | "work-tasks";
}
interface BoardStore extends Preferences {
  setStatusOrder(order: readonly BoardDisplayStatus[]): void;
  setWorkflowStatuses(statuses: readonly BoardWorkflowStatus[]): void;
  setItemWorkflowStatus(item: BoardItem, statusId: string): void;
  pickerOpen: boolean;
  markWorkTaskResultRead(item: BoardItem): void;
  setItemStaged(item: BoardItem, staged: boolean): void;
  reconcileStagedItems(items: BoardItem[]): void;
  setPickerOpen(open: boolean): void;
  selectProject(key: string | null): void;
  toggleProject(key: string, defaults?: string[], knownKeys?: string[]): void;
  setView(view: BoardView): void;
  setGroup(group: Preferences["group"]): void;
  setAgent(agent: string): void;
  setSearch(search: string): void;
  revealItem(item: BoardItem): void;
  setTracking(tracking: BoardTracking): void;
  includeItem(item: BoardTrackingTarget): void;
  selectStandalone(): void;
  selectWorkTasks(): void;
}
const key = "zcode-agent-board:v1";
const layoutVersion = 3;
const defaults: Preferences = {
  statusOrder: BOARD_DISPLAY_STATUSES,
  workflowStatuses: DEFAULT_BOARD_WORKFLOW_STATUSES,
  workflowAssignments: {},
  readWorkTaskResults: {},
  stagedItems: {},
  project: null,
  pinnedProjects: null,
  view: "all",
  group: "workflow",
  agent: "all",
  search: "",
  tracking: defaultBoardTracking,
  category: "all",
};
function readStatusOrder(value: unknown): readonly BoardDisplayStatus[] {
  // 顺序必须是完整排列，避免损坏偏好让某个状态及其暂存入口从界面消失。
  return Array.isArray(value) &&
    value.length === BOARD_DISPLAY_STATUSES.length &&
    BOARD_DISPLAY_STATUSES.every((status) => value.includes(status))
    ? [...value]
    : BOARD_DISPLAY_STATUSES;
}
function readTracking(value: unknown): BoardTracking {
  if (!value || typeof value !== "object") return defaultBoardTracking;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((k) => typeof k === "string");
  if (
    (v.mode !== "all" && v.mode !== "custom") ||
    typeof v.standalone !== "boolean" ||
    !strings(v.projects) ||
    !strings(v.includedItems) ||
    !strings(v.excludedItems)
  )
    return defaultBoardTracking;
  return {
    mode: v.mode,
    standalone: v.standalone,
    workTasks: v.workTasks === true,
    projects: [...new Set(v.projects)],
    includedItems: [...new Set(v.includedItems)],
    excludedItems: [...new Set(v.excludedItems)],
  };
}
function readStagedItems(value: unknown): BoardStagedItems {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (
    !entries.every(
      ([, marker]) =>
        marker &&
        typeof marker === "object" &&
        Number.isFinite(marker.updatedAt) &&
        marker.updatedAt >= 0 &&
        (marker.outcome === "completed" || marker.outcome === "error"),
    )
  )
    return {};
  return Object.fromEntries(
    entries.map(([key, marker]) => [key, { updatedAt: marker.updatedAt, outcome: marker.outcome }]),
  );
}
function readWorkflowStatuses(value: unknown): readonly BoardWorkflowStatus[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    return DEFAULT_BOARD_WORKFLOW_STATUSES;
  }
  const seen = new Set<string>();
  const statuses = value.filter((entry): entry is BoardWorkflowStatus => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.id) ||
      seen.has(entry.id) ||
      typeof entry.label !== "string" ||
      !entry.label.trim() ||
      entry.label.length > 40 ||
      typeof entry.enabled !== "boolean"
    )
      return false;
    seen.add(entry.id);
    return true;
  });
  return statuses.length === value.length && statuses.some((status) => status.enabled)
    ? statuses.map((status) => ({ ...status, label: status.label.trim() }))
    : DEFAULT_BOARD_WORKFLOW_STATUSES;
}
function readWorkflowAssignments(value: unknown, statuses: readonly BoardWorkflowStatus[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const activeIds = new Set(statuses.filter((status) => status.enabled).map((status) => status.id));
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, id]) => key.length > 0 && typeof id === "string" && activeIds.has(id),
    ),
  ) as Record<string, string>;
}
export function createAgentBoardStore(storage: BrowserStorageLike | null = getSafeLocalStorage()) {
  let initial = defaults;
  try {
    const v = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      v &&
      [
        "all",
        "active",
        "completed",
        "failed",
        "staged",
        "attention",
        "starred",
        "archived",
      ].includes(v.view) &&
      ["project", "status", "workflow"].includes(v.group) &&
      (v.project === null || typeof v.project === "string") &&
      (v.pinnedProjects === null ||
        (Array.isArray(v.pinnedProjects) &&
          v.pinnedProjects.every((p: unknown) => typeof p === "string"))) &&
      typeof v.agent === "string" &&
      typeof v.search === "string"
    ) {
      const workflowStatuses = readWorkflowStatuses(v.workflowStatuses);
      initial = {
        statusOrder: readStatusOrder(v.statusOrder),
        workflowStatuses,
        workflowAssignments: readWorkflowAssignments(v.workflowAssignments, workflowStatuses),
        readWorkTaskResults:
          v.readWorkTaskResults &&
          typeof v.readWorkTaskResults === "object" &&
          !Array.isArray(v.readWorkTaskResults) &&
          Object.values(v.readWorkTaskResults).every((token) => typeof token === "string")
            ? (Object.fromEntries(Object.entries(v.readWorkTaskResults)) as Record<string, string>)
            : {},
        stagedItems: readStagedItems(v.stagedItems),
        project: v.project,
        // 收藏入口已移除，旧偏好仅回到全部，不清除用户的范围和阅读记录。
        view: v.view === "attention" || v.view === "starred" ? "all" : v.view,
        // 首次升级到工作流分组，同时保留旧版已显式选择的状态分组。
        group: v.layoutVersion === layoutVersion || v.group === "status" ? v.group : "workflow",
        agent: v.agent,
        search: v.search,
        tracking: readTracking(v.tracking),
        category: v.category === "standalone" || v.category === "work-tasks" ? v.category : "all",
        pinnedProjects: v.pinnedProjects
          ? [...new Set<string>(v.pinnedProjects)].slice(0, 6)
          : null,
      };
    }
  } catch {
    /* 本地显示偏好损坏不能影响 Host 会话。 */
  }
  return createStore<BoardStore>((set, get) => {
    const save = (patch: Partial<Preferences>) => {
      set(patch);
      const {
        project,
        pinnedProjects,
        view,
        group,
        agent,
        search,
        tracking,
        category,
        stagedItems,
        readWorkTaskResults,
        statusOrder,
        workflowStatuses,
        workflowAssignments,
      } = get();
      try {
        storage?.setItem(
          key,
          JSON.stringify({
            statusOrder,
            workflowStatuses,
            workflowAssignments,
            stagedItems,
            readWorkTaskResults,
            layoutVersion,
            project,
            pinnedProjects,
            view,
            group,
            agent,
            search,
            tracking,
            category,
          }),
        );
      } catch {
        /* 受限存储只影响显示偏好，不回写 Host。 */
      }
    };
    return {
      ...initial,
      setStatusOrder: (order) => save({ statusOrder: readStatusOrder(order) }),
      setWorkflowStatuses: (value) => {
        const workflowStatuses = readWorkflowStatuses(value);
        const activeIds = new Set(
          workflowStatuses.filter((status) => status.enabled).map((status) => status.id),
        );
        const fallback = workflowStatuses.find((status) => status.enabled)!.id;
        const workflowAssignments = Object.fromEntries(
          Object.entries(get().workflowAssignments).map(([key, id]) => [
            key,
            activeIds.has(id) ? id : fallback,
          ]),
        );
        save({ workflowStatuses, workflowAssignments });
      },
      setItemWorkflowStatus: (item, statusId) => {
        if (!get().workflowStatuses.some((status) => status.id === statusId && status.enabled))
          return;
        save({ workflowAssignments: { ...get().workflowAssignments, [item.key]: statusId } });
      },
      pickerOpen: false,
      markWorkTaskResultRead: (item) => {
        if (item.kind !== "work-task" || !boardHasUnreadResult(item, get().readWorkTaskResults))
          return;
        save({
          readWorkTaskResults: {
            ...get().readWorkTaskResults,
            [item.key]: workTaskResultToken(item.workTask),
          },
        });
      },
      setItemStaged: (item, staged) => {
        const stagedItems = { ...get().stagedItems };
        if (staged) {
          if (!canStageBoardItem(item)) return;
          const outcome = boardDisplayStatus({ ...item, staged: false });
          if (outcome !== "completed" && outcome !== "error") return;
          stagedItems[item.key] = { updatedAt: item.updatedAt, outcome };
        } else delete stagedItems[item.key];
        save({ stagedItems });
      },
      reconcileStagedItems: (items) => {
        const stagedItems = { ...get().stagedItems };
        let changed = false;
        // 只清理实际观察到的新活动，断连或关闭工作区不能丢失暂存偏好。
        for (const item of items) {
          if (Object.hasOwn(stagedItems, item.key) && !isBoardItemStaged(item, stagedItems)) {
            delete stagedItems[item.key];
            changed = true;
          }
        }
        if (changed) save({ stagedItems });
      },
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
      selectProject: (project) =>
        save({ project, category: "all", ...(project === null ? { group: "workflow" } : {}) }),
      selectWorkTasks: () => save({ project: null, category: "work-tasks" }),
      selectStandalone: () => save({ project: null, category: "standalone" }),
      setTracking: (tracking) => save({ tracking: readTracking(tracking) }),
      includeItem: (item) => {
        const tracking = get().tracking;
        if (matchesBoardTracking(item, tracking)) return;
        // 菜单只纳入当前实体，并解除它的显式排除；不能扩大为整项目或覆盖其它选择。
        save({
          tracking: {
            ...tracking,
            includedItems: [...new Set([...tracking.includedItems, item.key])],
            excludedItems: tracking.excludedItems.filter((key) => key !== item.key),
          },
        });
      },
      toggleProject: (project, defaultKeys = [], knownKeys) => {
        const saved = get().pinnedProjects ?? defaultKeys;
        const current = knownKeys ? saved.filter((key) => knownKeys.includes(key)) : saved;
        if (current.includes(project))
          save({ pinnedProjects: current.filter((k) => k !== project) });
        else if (current.length < 6) save({ pinnedProjects: [...current, project] });
      },
      setView: (view) => save({ view }),
      setGroup: (group) => save({ group }),
      setAgent: (agent) => save({ agent }),
      setSearch: (search) => save({ search }),
      revealItem: (item) =>
        save({
          project: null,
          category: "all",
          group: "status",
          view: item.archived ? "archived" : "all",
          agent: "all",
          search: "",
        }),
    };
  });
}
export const agentBoardStore = createAgentBoardStore();
