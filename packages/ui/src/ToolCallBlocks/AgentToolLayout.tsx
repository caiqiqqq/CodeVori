import type { ComponentProps } from "react";
import { BotIcon } from "lucide-react";
import type { AgentColor } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { resolveSubagentColorFromName, SUBAGENT_TEXT_COLOR_CLASS } from "@/lib/subagentColors.js";
import { ToolLayout } from "./ToolLayout.js";

type AgentToolLayoutProps = Omit<
  ComponentProps<typeof ToolLayout>,
  | "icon"
  | "kindLabel"
  | "expandedKindLabel"
  | "kindDetail"
  | "expandedKindDetail"
  | "canToggle"
  | "forceOpen"
  | "summaryContentSeparator"
  | "animateSummaryContent"
> & {
  agentName?: string;
  agentColor?: AgentColor;
};

const AGENT_TOOL_ICON = <BotIcon className="size-4 shrink-0 text-foreground-subtle" />;

// 原生 Agent 与委派任务共用摘要外观；状态和打开子会话的动作仍由各自所有者提供。
export function AgentToolLayout({ agentName, agentColor, ...props }: AgentToolLayoutProps) {
  const { intl } = useZCodeIntl();
  const labelId = "chat.toolCall.agent.fallback";
  const translatedLabel = intl.formatMessage({ id: labelId });
  const label = translatedLabel === labelId ? "SubAgent" : translatedLabel;
  const nameDetail = agentName ? (
    <span
      className={cn(
        // inline-flex 与 1.5 倍行高保持名称和周围摘要文字垂直对齐。
        // 长模型名最多占摘要容器四分之一，避免窄会话把任务标题挤到 0 宽。
        "inline-flex max-w-[min(9rem,25cqw)] items-center truncate font-mono text-ui-base font-medium leading-[1.5]",
        SUBAGENT_TEXT_COLOR_CLASS[agentColor ?? resolveSubagentColorFromName(agentName)],
      )}
      title={agentName}
    >
      {agentName}
    </span>
  ) : null;

  return (
    <div className="@container/agent-summary min-w-0 w-full">
      <ToolLayout
        {...props}
        icon={AGENT_TOOL_ICON}
        kindLabel={label}
        expandedKindLabel={label}
        kindDetail={nameDetail}
        expandedKindDetail={nameDetail}
        canToggle={false}
        forceOpen={false}
        summaryContentSeparator="·"
        animateSummaryContent
      />
    </div>
  );
}
