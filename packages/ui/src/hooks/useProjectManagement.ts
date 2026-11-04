import { useMemo, useState, useRef } from "react";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { useSettings } from "./useSettingService.js";
import { resolveWorkspaceServices } from "@/lib/workspaceServiceResolver.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";

import { cleanProjectTaskData } from "@/settings/cleanProjectTaskData.js";

export function useProjectManagement() {
  const base = useBaseWorkspaceServices();
  const { settings, update } = useSettings(base);
  const tabs = useTabStore((state) => state.tabs);
  const closeTab = useTabStore((state) => state.closeTab);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const projects = useMemo(() => {
    const entries = new Map<
      string,
      {
        key: string;
        label: string;
        workspacePath: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
        remoteTarget?: unknown;
        tabIds: (typeof tabs)[number]["id"][];
      }
    >();
    for (const path of settings?.recentProjects ?? []) {
      entries.set(path, {
        key: path,
        workspacePath: path,
        label: path.split(/[\\/]/).pop() || path,
        tabIds: [],
      });
    }
    for (const tab of tabs) {
      if (!isWorkspaceTab(tab) || tab.workspacePurpose === "conversation") continue;
      const key = buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity);
      const previous = entries.get(key);
      entries.set(key, { ...tab, key, tabIds: [...(previous?.tabIds ?? []), tab.id] });
    }
    return [...entries.values()];
  }, [settings?.recentProjects, tabs]);

  const remove = async (keys: ReadonlySet<string>, cleanData: boolean) => {
    if (flight.current) return { removed: 0, errors: [] as string[] };
    flight.current = true;
    setBusy(true);
    const errors: string[] = [];
    let removed = 0;
    try {
      for (const project of projects.filter((entry) => keys.has(entry.key))) {
        try {
          if (cleanData) {
            const resolved = resolveWorkspaceServices(
              project,
              base,
              useRemoteWorkspaceSessionStore.getState(),
            );
            if (!resolved) throw new Error("Remote project is disconnected");
            await cleanProjectTaskData(resolved.services, {
              workspacePath: project.workspacePath,
              workspaceIdentity: project.workspaceIdentity,
            });
          }
          if (!project.workspaceIdentity && !project.remoteTarget && !project.remoteSessionId) {
            // 每项重读设置，避免批次使用旧快照覆盖同时打开的新项目。
            const latest = await base.settingService.get();
            await update({
              recentProjects: latest.recentProjects.filter(
                (path) => path !== project.workspacePath,
              ),
            });
          }
          // 设置写入失败时保留已打开的项目，避免移除报错却提前丢失页面。
          for (const id of project.tabIds) closeTab(id);
          removed += 1;
        } catch (error) {
          errors.push(
            `${project.label}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return { removed, errors };
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  return { projects, busy, remove };
}
