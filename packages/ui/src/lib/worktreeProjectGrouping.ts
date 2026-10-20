import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export interface WorktreeProjectGroup {
  tab: WorkspaceTabState;
  isLinkedWorktree: boolean;
  workspaceTabs: WorkspaceTabState[];
  worktrees: Array<{ tab: WorkspaceTabState; branchName?: string }>;
}

function normalizeGitPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isLocalProject(tab: WorkspaceTabState): boolean {
  return !tab.workspaceIdentity && !tab.remoteTarget && !tab.remoteSessionId;
}

/** Git 关系只控制项目展示；会话查询和操作仍使用各 tab 的真实 workspace 身份。 */
export function groupWorktreeProjectTabs(
  tabs: readonly WorkspaceTabState[],
  infoByPath: Readonly<Record<string, GitWorkspaceRepositoryInfo>>,
): WorktreeProjectGroup[] {
  const mainByRoot = new Map<string, WorkspaceTabState>();
  for (const tab of tabs) {
    const info = infoByPath[tab.workspacePath];
    if (isLocalProject(tab) && info?.kind === "main-tree" && info.repoRoot) {
      const root = normalizeGitPath(info.repoRoot);
      const previous = mainByRoot.get(root);
      if (!previous || normalizeGitPath(tab.workspacePath) === root) {
        mainByRoot.set(root, tab);
      }
    }
  }

  const childrenByParentId = new Map<string, WorktreeProjectGroup["worktrees"]>();
  const childIds = new Set<string>();
  for (const tab of tabs) {
    const info = infoByPath[tab.workspacePath];
    if (!isLocalProject(tab) || info?.kind !== "linked-worktree" || !info.mainWorktreePath) {
      continue;
    }
    const parent = mainByRoot.get(normalizeGitPath(info.mainWorktreePath));
    if (!parent || parent.id === tab.id) continue;
    const children = childrenByParentId.get(parent.id) ?? [];
    children.push({ tab, ...(info.branchName ? { branchName: info.branchName } : {}) });
    childrenByParentId.set(parent.id, children);
    childIds.add(tab.id);
  }

  return tabs
    .filter((tab) => !childIds.has(tab.id))
    .map((tab) => {
      const worktrees = childrenByParentId.get(tab.id) ?? [];
      return {
        tab,
        isLinkedWorktree:
          isLocalProject(tab) && infoByPath[tab.workspacePath]?.kind === "linked-worktree",
        // 修复原因：隐藏工作树目录行后，列表必须查询全部真实 scope，不能受旧子行展开态影响。
        workspaceTabs: [tab, ...worktrees.map((child) => child.tab)],
        worktrees,
      };
    });
}
