import { useEffect, useState } from "react";
import type { IMemoryService } from "@zcode/services";
import { logger } from "@/logger.js";

export type MemoryCatalogService = Pick<
  IMemoryService,
  "listProjectMemories" | "onDynamicProjectMemoriesChanged" | "resolveProjectMemoryWorkspaceId"
>;

export function useProjectMemoryUpdates(
  service: MemoryCatalogService,
  enabled: boolean,
  refresh: () => Promise<unknown>,
  workspacePath?: string,
  workspaceIdentity?: string,
) {
  const [preferred, setPreferred] = useState<{ key: string; id: string }>();
  const key = JSON.stringify([workspacePath, workspaceIdentity]);
  useEffect(() => {
    if (!enabled) return;
    // 先订阅再读取；刷新仅更新投影，Host/CLI 文件始终是事实来源。
    const subscription = service.onDynamicProjectMemoriesChanged()(() => {
      void refresh();
    });
    void refresh();
    return () => subscription.dispose();
  }, [enabled, service, refresh]);
  useEffect(() => {
    let disposed = false;
    if (enabled && workspacePath) {
      void service
        .resolveProjectMemoryWorkspaceId({ workspacePath, workspaceIdentity })
        .then((id) => {
          if (!disposed) setPreferred({ key, id });
        })
        .catch((error: unknown) => logger.warn("[memory] 当前项目范围读取失败", { error }));
    }
    return () => {
      disposed = true;
    };
  }, [enabled, key, service, workspacePath, workspaceIdentity]);
  return preferred?.key === key ? preferred.id : undefined;
}
