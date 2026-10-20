import type { AcpAgent, AcpSession } from "@zcode/shared";
import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";

/** Project only the selected conversation target into the shared context ring. */
export function composerContextUsage(
  acpAgent: AcpAgent | null,
  acpContextUsage: AcpSession["contextUsage"] | null,
  usage: SessionUsageState | null,
) {
  // 修复原因：同一个输入框切换模型时 native snapshot 仍存在，ACP 必须只读目标
  // 会话的容量，未知值保留为 null，由共享控件解释，不沿用另一 Agent 或 API 的旧值。
  if (acpAgent) return acpContextUsage;
  const contextWindow = usage?.contextWindow;
  if (!contextWindow) return null;
  return {
    used: contextWindow.usedTokens,
    size: contextWindow.maxTokens,
    ...(contextWindow.cache ? { cache: contextWindow.cache } : {}),
    ...(contextWindow.breakdown ? { breakdown: contextWindow.breakdown } : {}),
  };
}
