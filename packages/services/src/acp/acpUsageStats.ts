import {
  acpUsageReportSchema,
  type AcpAppUsageAgent,
  type AcpUsageReport,
  type AcpSession,
  type AppUsageRequest,
} from "@zcode/shared";

/** A missing or discontinuous cumulative report changes the baseline, never a past turn. */
export function recordAcpPromptUsage(
  session: AcpSession,
  commandId: string,
  report: AcpUsageReport | null | void,
): void {
  if (session.usageTurns.some((turn) => turn.commandId === commandId)) return;
  const parsed = acpUsageReportSchema.safeParse(report);
  if (!parsed.success) {
    session.usageBaselineKnown = false;
    return;
  }

  if (parsed.data.scope === "turn") {
    session.usageTurns.push({ commandId, ...parsed.data.usage, models: parsed.data.models });
    session.usageBaselineKnown = false;
    return;
  }
  const current = parsed.data.usage;
  const previous = session.usageBaseline;
  const continuous =
    session.usageBaselineKnown &&
    (!previous ||
      (current.totalTokens >= previous.totalTokens &&
        current.inputTokens >= previous.inputTokens &&
        current.outputTokens >= previous.outputTokens));
  // 修复原因：ACP 报告为会话累计值；旧会话/缺报/重置后直接求差会把其它轮次
  // 错记到当前命令。未知轮只重建基线，下一份连续报告才可计数。
  if (continuous) {
    session.usageTurns.push({
      commandId,
      totalTokens: current.totalTokens - (previous?.totalTokens ?? 0),
      inputTokens: current.inputTokens - (previous?.inputTokens ?? 0),
      outputTokens: current.outputTokens - (previous?.outputTokens ?? 0),
      models: [],
    });
  }
  session.usageBaseline = current;
  session.usageBaselineKnown = true;
}

/** Only accepted user entries count as turns. A usage fact without its entry is ignored. */
export function summarizeAcpUsage(
  sessions: readonly AcpSession[],
  request: AppUsageRequest,
  until: number = Date.now(),
): AcpAppUsageAgent[] {
  const days = request.range === "7d" ? 7 : request.range === "30d" ? 30 : null;
  const since = days === null ? 0 : until - days * 86_400_000;
  const groups = new Map<AcpSession["agent"], AcpAppUsageAgent>();
  for (const session of sessions) {
    if (session.provisional) continue;
    const facts = new Map(session.usageTurns.map((fact) => [fact.commandId, fact]));
    const seen = new Set<string>();
    let hasTurn = false;
    for (const entry of session.entries) {
      if (entry.kind !== "user" || !entry.id.startsWith("user:")) continue;
      const commandId = entry.id.slice("user:".length);
      if (seen.has(commandId)) continue;
      seen.add(commandId);
      // 修复原因：旧会话没有消息时间，区间统计不能以快照 mtime 伪造其发生日。
      if (entry.createdAt === undefined) {
        if (days !== null) continue;
      } else if (entry.createdAt < since || entry.createdAt > until) continue;
      const group = groups.get(session.agent) ?? {
        agent: session.agent,
        sessions: 0,
        turns: 0,
        measuredTurns: 0,
        unknownTurns: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        models: [],
      };
      hasTurn = true;
      group.turns++;
      const fact = facts.get(commandId);
      if (fact) {
        group.measuredTurns++;
        group.totalTokens += fact.totalTokens;
        group.inputTokens += fact.inputTokens;
        group.outputTokens += fact.outputTokens;
        for (const model of fact.models) {
          const previous = group.models.find((item) => item.modelId === model.modelId);
          if (previous) {
            previous.totalTokens += model.totalTokens;
            previous.inputTokens += model.inputTokens;
            previous.outputTokens += model.outputTokens;
          } else group.models.push({ ...model });
        }
      } else {
        group.unknownTurns++;
      }
      groups.set(session.agent, group);
    }
    if (hasTurn) groups.get(session.agent)!.sessions++;
  }
  return [...groups.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}
