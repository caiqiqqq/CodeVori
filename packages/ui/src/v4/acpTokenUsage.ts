import type { AcpSession, AcpTokenUsage } from "@zcode/shared";

import type { ContextTokenUsageData } from "@/chat-input-toolbar/contextTokenUsage.js";
export type AcpContextTokenUsage = ContextTokenUsageData;
/** Read-only projection: native cumulative and confirmed turns are alternative sources. */
export function projectAcpTokenUsage(session: AcpSession | null): AcpContextTokenUsage | null {
  if (!session) return null;
  if (session.nativeUsage?.nativeSessionId === session.acpSessionId)
    return { source: "native", usage: session.nativeUsage.usage };
  const turns = session.usageTurns;
  if (!turns.length) return { source: "turns", measuredTurns: 0, usage: null };
  const usage: AcpTokenUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
  for (const turn of turns) {
    usage.totalTokens += turn.totalTokens;
    usage.inputTokens += turn.inputTokens;
    usage.outputTokens += turn.outputTokens;
  }
  for (const key of ["cacheReadTokens", "cacheWriteTokens"] as const) {
    // 修复原因：旧快照缺失缓存维度是未知，不能只累加新轮次后冒充完整命中率。
    if (turns.every((turn) => turn[key] !== undefined))
      usage[key] = turns.reduce((sum, turn) => sum + turn[key]!, 0);
  }
  return { source: "turns", measuredTurns: turns.length, usage };
}
