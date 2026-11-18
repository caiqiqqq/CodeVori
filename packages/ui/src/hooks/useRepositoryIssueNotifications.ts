import { useEffect, useEffectEvent, useRef } from "react";
import type { IPlatformService, RepositoryIssueDiscovery } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/index.js";
import { logger } from "@/logger.js";
import type { RepositoryIssueReadSource } from "./repositoryIssueReadModel.js";

/** 只投递 Host 已确认的新增事实，不从 UI 数量差值重新推导新增。 */
export function useRepositoryIssueNotifications({
  sources,
  enabled,
  platform,
  formatMessage,
}: {
  sources: readonly RepositoryIssueReadSource[];
  enabled: boolean;
  platform: Pick<
    IPlatformService,
    "showTaskNotification" | "onTaskNotificationClick" | "openExternal"
  > | null;
  formatMessage: IntlInstance["formatMessage"];
}) {
  const targets = useRef(new Map<string, string>());
  const notify = useEffectEvent(
    (taskId: string, item: RepositoryIssueDiscovery, kind: "issue" | "merge-request") => {
      if (!enabled || !platform) return false;
      platform.showTaskNotification({
        taskId,
        status: kind === "issue" ? "repository_issue" : "repository_merge_request",
        title: formatMessage({
          id:
            kind === "issue"
              ? "notification.newRepositoryIssue"
              : "notification.newRepositoryMergeRequest",
        }),
        body: `${item.repositoryName} #${item.number}: ${item.title}`,
      });
      return true;
    },
  );
  useEffect(
    () =>
      platform?.onTaskNotificationClick((id) => {
        const url = targets.current.get(id);
        if (url) platform.openExternal(url);
      }),
    [platform],
  );
  useEffect(() => {
    let live = true;
    const seen = new Map<string, number>();
    const subscriptions = sources.map(({ resource }) => {
      if (!resource) return;
      let established = false;
      let lastData: ReturnType<typeof resource.getSnapshot>["data"] = null;
      const observe = () => {
        if (!live) return;
        const { data, error, loading } = resource.getSnapshot();
        if (!data || error || loading || data === lastData) return;
        lastData = data;
        const previous = new Map(seen);
        const collections = [
          ["issue", data.newIssues ?? []],
          ["merge-request", data.newMergeRequests ?? []],
        ] as const;
        for (const [kind, items] of collections) {
          for (const item of items) {
            const scope = `${kind}:${item.repositoryKey}`;
            const id = JSON.stringify([`repository-${scope}`, item.number]);
            seen.set(scope, Math.max(seen.get(scope) ?? 0, item.number));
            if (item.number <= (previous.get(scope) ?? 0)) continue;
            // 重挂载或换 Host 的第一个快照只建立投递基线，不能补发近期历史。
            if (!established) continue;
            try {
              if (notify(id, item, kind)) targets.current.set(id, item.url);
            } catch (error) {
              logger.warn("[repository-notification] 触发平台通知失败", { error, kind });
            }
          }
        }
        established = true;
        while (targets.current.size > 1000)
          targets.current.delete(targets.current.keys().next().value!);
      };
      const unsubscribe = resource.subscribe(observe);
      observe();
      return unsubscribe;
    });
    return () => {
      live = false;
      subscriptions.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [platform, sources]);
}
