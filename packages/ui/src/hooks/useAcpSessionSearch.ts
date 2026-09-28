import { useEffect, useMemo, useState } from "react";
import { acpSessionSearchResultSchema, type AcpSessionSearchItem } from "@zcode/shared";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { buildWorkspaceServiceLookup } from "@/lib/workspaceServiceResolver.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { logger } from "@/logger.js";

/** 搜索只保存 Host 返回的展示投影，关闭浮层后释放所有观察。 */
export function useAcpSessionSearch(workspaceTabs: WorkspaceTabState[], query: string) {
  const baseServices = useBaseWorkspaceServices();
  const sessionsById = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const sessionIdByWorkspaceIdentity = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspaceIdentity,
  );
  const sessionIdByWorkspacePath = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspacePath,
  );
  const targets = useMemo(() => {
    const lookup = buildWorkspaceServiceLookup(workspaceTabs, baseServices, {
      sessionsById,
      sessionIdByWorkspaceIdentity,
      sessionIdByWorkspacePath,
    });
    return [...lookup].map(([key, resolved]) => ({
      key,
      service: resolved.services.acpService,
      workspace: {
        workspacePath: workspaceTabs.find(
          (tab) => (tab.workspaceIdentity?.trim() || tab.workspacePath) === key,
        )!.workspacePath,
        workspaceIdentity: workspaceTabs.find(
          (tab) => (tab.workspaceIdentity?.trim() || tab.workspacePath) === key,
        )?.workspaceIdentity,
        remoteSessionId: resolved.remoteSessionId,
      },
    }));
  }, [
    baseServices,
    sessionIdByWorkspaceIdentity,
    sessionIdByWorkspacePath,
    sessionsById,
    workspaceTabs,
  ]);
  const [results, setResults] = useState<
    Record<
      string,
      {
        target: (typeof targets)[number];
        query: string;
        items: AcpSessionSearchItem[];
        loading: boolean;
        failed: boolean;
      }
    >
  >({});

  useEffect(() => {
    let live = true;
    setResults(
      Object.fromEntries(
        targets.map((target) => [
          target.key,
          { target, query, items: [], loading: true, failed: false },
        ]),
      ),
    );
    const subscriptions = targets.map((target) => {
      const { key, service, workspace } = target;
      let serial = 0;
      let scheduled = false;
      const load = async () => {
        const request = ++serial;
        try {
          const items = acpSessionSearchResultSchema.parse(
            await service.search({ ...workspace, query, limit: 80 }),
          );
          if (live && request === serial)
            setResults((previous) => ({
              ...previous,
              [key]: { target, query, items, loading: false, failed: false },
            }));
        } catch (error: unknown) {
          if (!live || request !== serial) return;
          logger.warn("[acp-search] 读取智能体搜索结果失败", {
            errorType: error instanceof Error ? error.name : "unknown",
          });
          setResults((previous) => ({
            ...previous,
            [key]: { target, query, items: [], loading: false, failed: true },
          }));
        }
      };
      // 修复原因：事件先让在途请求失效；旧正文/删除前的结果不能晚到并覆盖新事实。
      const subscription = service.onDynamicSessionChanged(workspace)((change) => {
        serial += 1;
        if (!live) return;
        if (change.kind === "removed")
          setResults((previous) => ({
            ...previous,
            [key]: {
              target,
              query,
              loading: true,
              failed: false,
              items:
                previous[key]?.target === target && previous[key].query === query
                  ? previous[key].items.filter((item) => item.id !== change.id)
                  : [],
            },
          }));
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (live) void load();
        });
      });
      void load();
      return subscription;
    });
    return () => {
      live = false;
      subscriptions.forEach((subscription) => subscription.dispose());
    };
  }, [query, targets]);

  return useMemo(() => {
    // 修复原因：同一 workspace key 可能切换 Host，旧 Host 的投影不能短暂显示在新目标上。
    const current = targets
      .map((target) => results[target.key])
      .filter(
        (result): result is NonNullable<typeof result> =>
          result?.query === query && targets.includes(result.target),
      );
    return {
      items: current.flatMap((result) => result.items),
      loading: targets.length > current.length || current.some((result) => result.loading),
      failed: current.some((result) => result.failed),
    };
  }, [query, results, targets]);
}
