import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";
import {
  defaultBoardTracking,
  canStageBoardItem,
  isBoardItemStaged,
  boardDisplayStatus,
  boardHasUnreadResult,
  workTaskResultToken,
  type BoardItem,
  type BoardStagedItems,
  type BoardTracking,
  type BoardView,
} from "@/agent-board/agentBoardModel.js";
interface Preferences {
  readWorkTaskResults: Record<string, string>;
  stagedItems: BoardStagedItems;
  project: string | null;
  pinnedProjects: string[] | null;
  view: BoardView;
  group: "project" | "status";
  agent: string;
  search: string;
  tracking: BoardTracking;
  category: "all" | "standalone" | "work-tasks";
}
interface BoardStore extends Preferences {
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
  setTracking(tracking: BoardTracking): void;
  selectStandalone(): void;
  selectWorkTasks(): void;
}
const key = "zcode-agent-board:v1";
const layoutVersion = 2;
const defaults: Preferences = {
  readWorkTaskResults: {},
  stagedItems: {},
  project: null,
  pinnedProjects: null,
  view: "all",
  group: "status",
  agent: "all",
  search: "",
  tracking: defaultBoardTracking,
  category: "all",
};
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
      ["project", "status"].includes(v.group) &&
      (v.project === null || typeof v.project === "string") &&
      (v.pinnedProjects === null ||
        (Array.isArray(v.pinnedProjects) &&
          v.pinnedProjects.every((p: unknown) => typeof p === "string"))) &&
      typeof v.agent === "string" &&
      typeof v.search === "string"
    )
      initial = {
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
        // 旧默认项目分组曾遮住三状态列；只迁移布局，不清除用户的跟踪范围。
        group: v.layoutVersion === layoutVersion ? v.group : "status",
        agent: v.agent,
        search: v.search,
        tracking: readTracking(v.tracking),
        category: v.category === "standalone" || v.category === "work-tasks" ? v.category : "all",
        pinnedProjects: v.pinnedProjects
          ? [...new Set<string>(v.pinnedProjects)].slice(0, 6)
          : null,
      };
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
      } = get();
      try {
        storage?.setItem(
          key,
          JSON.stringify({
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
        save({ project, category: "all", ...(project === null ? { group: "status" } : {}) }),
      selectWorkTasks: () => save({ project: null, category: "work-tasks" }),
      selectStandalone: () => save({ project: null, category: "standalone" }),
      setTracking: (tracking) => save({ tracking: readTracking(tracking) }),
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
    };
  });
}
export const agentBoardStore = createAgentBoardStore();
