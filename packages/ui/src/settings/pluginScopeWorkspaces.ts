import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { formatRemoteWorkspaceTargetSubtitle } from "@/lib/remoteWorkspaceHistory.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export interface PluginScopeWorkspaceOption {
  key: string;
  label: string;
  remote?: boolean;
  description?: string;
}

export function getPluginWorkspaceKey(tab: WorkspaceTabState): string {
  return getWorkspaceKey(tab.workspacePath, tab.workspaceIdentity);
}

export function isPluginScopeWorkspaceConnected(tab: WorkspaceTabState): boolean {
  // 持久化 tab 会保留已经断开的远端项目和已失效的本地目录；Scope 若继续展示，
  // 用户会选中一个没有可用 service target 的项目。远端必须有当前 session，本地必须仍可用。
  if (tab.availability === "unavailable-local-directory") {
    return false;
  }
  const isRemote = Boolean(
    tab.workspaceIdentity?.trim() || tab.remoteTarget || tab.remoteSessionId,
  );
  return !isRemote || Boolean(tab.remoteSessionId);
}

export function getPluginScopeWorkspaceOptions(
  tabs: readonly WorkspaceTabState[],
): PluginScopeWorkspaceOption[] {
  return tabs.filter(isPluginScopeWorkspaceConnected).map((tab) => {
    const key = getPluginWorkspaceKey(tab);
    const remote = Boolean(
      tab.workspaceIdentity?.trim() || tab.remoteTarget || tab.remoteSessionId,
    );
    return {
      key,
      label: tab.label,
      remote,
      description: tab.remoteTarget
        ? `${formatRemoteWorkspaceTargetSubtitle(tab.remoteTarget)} · ${tab.workspacePath}`
        : remote
          ? key
          : tab.workspacePath,
    };
  });
}

export function resolvePluginScopeWorkspaceOptions(
  options: readonly PluginScopeWorkspaceOption[],
): PluginScopeWorkspaceOption[] {
  // 作用域是工作区身份而不是 tab 或名称：重复 tab 只展示一次，不同路径/主机的
  // 同名项目必须保留，否则设置会路由到错误的工作区；名称冲突时补充定位信息。
  const byKey = new Map<string, PluginScopeWorkspaceOption>();
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    if (byKey.has(option.key)) continue;
    byKey.set(option.key, option);
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  }
  return Array.from(byKey.values(), (option) => ({
    ...option,
    description:
      (labelCounts.get(option.label) ?? 0) > 1 ? option.description || option.key : undefined,
  }));
}
