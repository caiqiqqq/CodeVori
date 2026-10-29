import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";
import {
  defaultBoardTracking,
  type BoardTracking,
  type BoardView,
} from "@/agent-board/agentBoardModel.js";
interface Preferences {
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
export function createAgentBoardStore(storage: BrowserStorageLike | null = getSafeLocalStorage()) {
  let initial = defaults;
  try {
    const v = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      v &&
      ["all", "active", "completed", "failed", "attention", "starred", "archived"].includes(
        v.view,
      ) &&
      ["project", "status"].includes(v.group) &&
      (v.project === null || typeof v.project === "string") &&
      (v.pinnedProjects === null ||
        (Array.isArray(v.pinnedProjects) &&
          v.pinnedProjects.every((p: unknown) => typeof p === "string"))) &&
      typeof v.agent === "string" &&
      typeof v.search === "string"
    )
      initial = {
        project: v.project,
        view: v.view === "attention" ? "all" : v.view,
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
      const { project, pinnedProjects, view, group, agent, search, tracking, category } = get();
      try {
        storage?.setItem(
          key,
          JSON.stringify({
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
