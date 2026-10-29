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
  const notify = useEffectEvent((taskId: string, issue: RepositoryIssueDiscovery) => {
    if (!enabled || !platform) return false;
    platform.showTaskNotification({
      taskId,
      status: "repository_issue",
      title: formatMessage({ id: "notification.newRepositoryIssue" }),
      body: `${issue.repositoryName} #${issue.number}: ${issue.title}`,
    });
    return true;
  });
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
        for (const issue of data.newIssues ?? []) {
          const id = JSON.stringify(["repository-issue", issue.repositoryKey, issue.number]);
          seen.set(issue.repositoryKey, Math.max(seen.get(issue.repositoryKey) ?? 0, issue.number));
          if (issue.number <= (previous.get(issue.repositoryKey) ?? 0)) continue;
          // 重挂载或换 Host 的第一个快照只建立投递基线，不能补发近期历史。
          if (!established) continue;
          try {
            if (notify(id, issue)) targets.current.set(id, issue.url);
          } catch (error) {
            logger.warn("[repository-issue-notification] 触发平台通知失败", { error });
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
