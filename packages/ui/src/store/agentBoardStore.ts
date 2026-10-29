import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";
import type { BoardView } from "@/agent-board/agentBoardModel.js";
interface Preferences {
  project: string | null;
  pinnedProjects: string[] | null;
  view: BoardView;
  group: "project" | "status";
  agent: string;
  search: string;
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
}
const key = "zcode-agent-board:v1";
const defaults: Preferences = {
  project: null,
  pinnedProjects: null,
  view: "all",
  group: "project",
  agent: "all",
  search: "",
};
export function createAgentBoardStore(storage: BrowserStorageLike | null = getSafeLocalStorage()) {
  let initial = defaults;
  try {
    const v = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      v &&
      ["all", "active", "attention", "starred", "archived"].includes(v.view) &&
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
        view: v.view,
        group: v.group,
        agent: v.agent,
        search: v.search,
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
      const { project, pinnedProjects, view, group, agent, search } = get();
      try {
        storage?.setItem(
          key,
          JSON.stringify({ project, pinnedProjects, view, group, agent, search }),
        );
      } catch {
        /* 受限存储只影响显示偏好，不回写 Host。 */
      }
    };
    return {
      ...initial,
      pickerOpen: false,
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
      selectProject: (project) => save({ project }),
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
