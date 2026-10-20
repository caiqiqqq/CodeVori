import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";

interface RepositoryScope {
  workspacePath: string;
  workspaceIdentity?: string;
}
interface RepositoryPreference {
  project: RepositoryScope | null;
  remotes: Record<string, string>;
}
interface RepositoryNavigation extends RepositoryPreference {
  selectProject(scope: RepositoryScope): void;
  selectRemote(scope: RepositoryScope, name: string): void;
  clearRemote(scope: RepositoryScope, expectedName: string): void;
}

const STORAGE_KEY = "zcode-repository-navigation:v1";
const workspaceKey = (scope: RepositoryScope) =>
  scope.workspaceIdentity?.trim() || scope.workspacePath;

function readPreference(storage: BrowserStorageLike | null): RepositoryPreference {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (
      value &&
      (value.project === null ||
        (typeof value.project?.workspacePath === "string" &&
          value.project.workspacePath.trim() &&
          (value.project.workspaceIdentity === undefined ||
            typeof value.project.workspaceIdentity === "string"))) &&
      value.remotes &&
      typeof value.remotes === "object" &&
      !Array.isArray(value.remotes) &&
      Object.values(value.remotes).every((name) => typeof name === "string" && name.trim())
    ) {
      const identity = value.project?.workspaceIdentity?.trim();
      return {
        project: value.project
          ? {
              workspacePath: value.project.workspacePath,
              ...(identity ? { workspaceIdentity: identity } : {}),
            }
          : null,
        remotes: { ...value.remotes },
      };
    }
  } catch {
    // 损坏或受限的本地偏好不能阻断仓库入口。
  }
  return { project: null, remotes: {} };
}

export function createRepositoryNavigationStore(
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
) {
  return createStore<RepositoryNavigation>((set, get) => {
    const save = (preference: RepositoryPreference) => {
      set(preference);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(preference));
      } catch {
        // 存储不可写时仍保留当前窗口的选择，离开面板不应丢失 remote。
      }
    };
    return {
      ...readPreference(storage),
      selectProject(scope) {
        const identity = scope.workspaceIdentity?.trim();
        const project = {
          workspacePath: scope.workspacePath,
          ...(identity ? { workspaceIdentity: identity } : {}),
        };
        if (
          get().project?.workspacePath !== project.workspacePath ||
          get().project?.workspaceIdentity !== project.workspaceIdentity
        )
          save({ project, remotes: get().remotes });
      },
      selectRemote(scope, name) {
        const key = workspaceKey(scope);
        if (get().remotes[key] !== name)
          save({ project: get().project, remotes: { ...get().remotes, [key]: name } });
      },
      clearRemote(scope, expectedName) {
        const key = workspaceKey(scope);
        // remote 已删除的旧回复不能撤销用户刚选中的另一个 remote。
        if (get().remotes[key] !== expectedName) return;
        const remotes = { ...get().remotes };
        delete remotes[key];
        save({ project: get().project, remotes });
      },
    };
  });
}

export const repositoryNavigationStore = createRepositoryNavigationStore();
