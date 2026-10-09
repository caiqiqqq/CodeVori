import type { WorkspaceTabState } from "../store/tabStore.js";
import { getPathLeaf } from "./path.js";

export function workTaskProjectOptions(tabs: readonly WorkspaceTabState[]) {
  const unique = new Map<string, WorkspaceTabState>();
  for (const tab of tabs) {
    const key = tab.workspaceIdentity?.trim() || tab.workspacePath;
    if (!unique.has(key)) unique.set(key, tab);
  }
  const projects = [...unique.values()];
  const counts = new Map<string, number>();
  const label = (tab: WorkspaceTabState) => tab.label || getPathLeaf(tab.workspacePath);
  for (const tab of projects) counts.set(label(tab), (counts.get(label(tab)) ?? 0) + 1);
  return projects.map((tab) => ({
    tab,
    label: label(tab),
    // 同名不代表同项目；展示真实路径/identity，不能用名称去重破坏远端隔离。
    description:
      (counts.get(label(tab)) ?? 0) > 1
        ? [tab.workspacePath, tab.workspaceIdentity?.trim()].filter(Boolean).join(" · ")
        : undefined,
  }));
}
