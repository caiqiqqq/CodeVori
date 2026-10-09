import { createStore } from "zustand/vanilla";
import type { WorkTaskScope } from "@zcode/shared";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";

const STORAGE_KEY = "zcode-work-task-navigation:v1";
export const WORK_TASK_ALL_PROJECTS = "all-projects";
interface NavigationPreference {
  project: string | null;
  tasks: Record<string, string>;
}
interface WorkTaskNavigation extends NavigationPreference {
  selectProject(scope: WorkTaskScope): void;
  selectAllProjects(): void;
  selectTask(scope: WorkTaskScope, id: string): void;
  clearTask(scope: WorkTaskScope, expectedId: string): void;
}

export function workTaskNavigationKey(scope: WorkTaskScope): string {
  return JSON.stringify([
    scope.workspaceIdentity?.trim() || scope.workspacePath,
    scope.remoteSessionId?.trim() || "",
  ]);
}

export function workTaskSelectionKey(task: WorkTaskScope & { id: string }): string {
  return JSON.stringify([workTaskNavigationKey(task), task.id]);
}

function readPreference(storage: BrowserStorageLike | null): NavigationPreference {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (
      value &&
      (value.project === null || typeof value.project === "string") &&
      value.tasks &&
      typeof value.tasks === "object" &&
      !Array.isArray(value.tasks) &&
      Object.values(value.tasks).every((id) => typeof id === "string")
    )
      return { project: value.project, tasks: value.tasks };
  } catch {
    // 导航偏好损坏或存储不可读时回到默认项目，不阻断任务页面。
  }
  return { project: null, tasks: {} };
}

export function createWorkTaskNavigationStore(
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
) {
  return createStore<WorkTaskNavigation>((set, get) => {
    const save = (preference: NavigationPreference) => {
      set(preference);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(preference));
      } catch {
        // 存储受限时仍在当前窗口记忆选择，避免离开页面就丢失导航位置。
      }
    };
    return {
      ...readPreference(storage),
      selectAllProjects() {
        save({ project: WORK_TASK_ALL_PROJECTS, tasks: get().tasks });
      },
      selectProject(scope) {
        const project = workTaskNavigationKey(scope);
        if (get().project !== project) save({ project, tasks: get().tasks });
      },
      selectTask(scope, id) {
        const key = workTaskNavigationKey(scope);
        if (get().tasks[key] !== id)
          save({ project: get().project, tasks: { ...get().tasks, [key]: id } });
      },
      clearTask(scope, expectedId) {
        const key = workTaskNavigationKey(scope);
        // 旧会话 pane 的迟到关闭事件不能撤销已经选中的新任务。
        if (get().tasks[key] !== expectedId) return;
        const tasks = { ...get().tasks };
        delete tasks[key];
        save({ project: get().project, tasks });
      },
    };
  });
}

export const workTaskNavigationStore = createWorkTaskNavigationStore();
