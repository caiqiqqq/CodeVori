import { GitBranch } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 只展示 Git 已确认的工作树身份，不把目录状态写入会话或创建新的导航入口。 */
export function WorktreeConversationIndicator({ workspacePath }: { workspacePath: string }) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "taskList.worktreeConversation" });
  return (
    // 修复原因：聚焦会切换为置顶/归档，身份标记不再加入 Tab 顺序；真实路径由会话行持续描述。
    <span
      role="img"
      aria-label={label}
      data-testid="worktree-conversation-indicator"
      data-worktree-path={workspacePath}
      className="inline-flex size-4 shrink-0 items-center justify-center text-foreground-subtlest"
    >
      <GitBranch className="size-3.5" aria-hidden="true" />
    </span>
  );
}
