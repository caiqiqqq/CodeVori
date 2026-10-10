import { CircleDot, ExternalLink, GitPullRequest } from "lucide-react";
import type { WorkTask } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { safeRepositoryExternalUrl } from "@/lib/forgePanel.js";
import { logger } from "@/logger.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskSourceLink({
  task,
  compact = false,
}: {
  task: Pick<WorkTask, "source">;
  compact?: boolean;
}) {
  const t = useWorkTaskMessages();
  const platform = usePlatform();
  const source = task.source;
  if (!source) return null;
  const item = t(source.kind === "issue" ? "sourceIssue" : "sourcePullRequest", {
    number: source.number,
  });
  const url = safeRepositoryExternalUrl(source.url);
  const Icon = source.kind === "issue" ? CircleDot : GitPullRequest;
  return (
    <ControlHintTooltip title={`${item} · ${source.title}`} description={source.url}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="work-task-source-link"
        className={
          compact
            ? "shrink-0 gap-1 px-1 text-ui-xs text-icon-blue"
            : "min-w-0 max-w-full justify-start gap-1.5 px-1 text-ui-sm text-icon-blue"
        }
        aria-label={t("openSource", { item, title: source.title })}
        disabled={!url}
        onClick={() => {
          // 来源入口独立于任务选择：只使用保存的条目 URL，不触发任务或议题写入。
          if (url)
            void (async () => {
              try {
                await platform.openExternal(url);
              } catch {
                logger.warn("[WorkTaskSourceLink] 打开关联议题链接失败");
              }
            })();
        }}
      >
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span className="shrink-0">{item}</span>
        {!compact ? (
          <>
            <span className="min-w-0 truncate">· {source.title}</span>
            <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
          </>
        ) : null}
      </Button>
    </ControlHintTooltip>
  );
}
