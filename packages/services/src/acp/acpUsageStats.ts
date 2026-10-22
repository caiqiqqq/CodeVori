import {
  acpUsageReportSchema,
  createAppUsageHourlyAccumulator,
  type AcpAppUsageAgent,
  type AcpUsageReport,
  type AcpSession,
  type AppUsageRequest,
  type AcpTokenUsage,
} from "@zcode/shared";

import { codexUsageKey, type CodexUsageHistory } from "./acpNativeUsage.js";

function createNativeTurnLookup(turns: CodexUsageHistory["turns"], until: number) {
  // 修复原因：逐条用户消息 filter 整份原生轮次会产生平方级扫描；局部索引
  // 保留乱序、缺时间和未完成边界的原规则，不修改 Host 持有的事实。
  const dated = turns
    .flatMap((turn) =>
      turn.startedAt !== null && turn.startedAt <= until
        ? [
            {
              time: turn.startedAt,
              measured:
                turn.complete &&
                turn.measured &&
                turn.finishedAt !== null &&
                turn.finishedAt <= until,
            },
          ]
        : [],
    )
    .sort((a, b) => a.time - b.time);
  const unknown = [0];
  for (const turn of dated) unknown.push(unknown[unknown.length - 1]! + (turn.measured ? 0 : 1));
  const lowerBound = (time: number) => {
    let low = 0;
    let high = dated.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (dated[mid]!.time < time) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return (from: number | undefined, to: number) => {
    if (from === undefined) return false;
    const start = lowerBound(from);
    const end = lowerBound(to);
    return end > start && unknown[end] === unknown[start];
  };
}

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
      ...cacheDelta(current, previous),
      models: [],
    });
  }
  session.usageBaseline = current;
  session.usageBaselineKnown = true;
}

/** ACP native requests and confirmed whole turns are alternative sources, never summed twice. */
export function summarizeAcpUsage(
  sessions: readonly AcpSession[],
  request: AppUsageRequest,
  until: number = Date.now(),
  histories: ReadonlyMap<string, CodexUsageHistory> = new Map(),
): AcpAppUsageAgent[] {
  const days = request.range === "7d" ? 7 : request.range === "30d" ? 30 : null;
  const since = days === null ? 0 : until - days * 86_400_000;
  const inRange = (time: number | null | undefined) =>
    time == null ? days === null : time >= since && time <= until;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: request.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const groups = new Map<AcpSession["agent"], AcpAppUsageAgent>();
  const hourlyByAgent = new Map<
    AcpSession["agent"],
    ReturnType<typeof createAppUsageHourlyAccumulator>
  >();
  const seenNative = new Set<string>();
  for (const session of sessions) {
    if (session.provisional) continue;
    const nativeKey = codexUsageKey(session);
    const history = session.agent === "codex" ? histories.get(nativeKey) : undefined;
    if (history && seenNative.has(nativeKey)) continue;
    if (history) seenNative.add(nativeKey);
    const hourly =
      hourlyByAgent.get(session.agent) ?? createAppUsageHourlyAccumulator(request.timeZone, until);
    hourlyByAgent.set(session.agent, hourly);
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
      dailyUsage: [],
      hourlyUsage: hourly.usage,
    };
    const entries = session.entries.filter(
      (entry) => entry.kind === "user" && entry.id.startsWith("user:"),
    );
    const measuredNativeTurn = history ? createNativeTurnLookup(history.turns, until) : null;
    const nextTimes: number[] = [];
    if (history) {
      let next = Infinity;
      for (let index = entries.length - 1; index >= 0; index--) {
        nextTimes[index] = next;
        const time = entries[index]!.createdAt;
        if (time !== undefined) next = time;
      }
    }
    const facts = new Map(session.usageTurns.map((fact) => [fact.commandId, fact]));
    const seen = new Set<string>();
    let included = false;
    if (history) {
      for (const record of history.records) {
        if (!inRange(record.timestamp)) continue;
        included = true;
        addUsage(
          group,
          record.usage,
          record.modelId ? [{ ...record.usage, modelId: record.modelId }] : [],
          record.timestamp,
          formatter,
          hourly,
        );
      }
    }
    for (const [index, entry] of entries.entries()) {
      const commandId = entry.id.slice("user:".length);
      if (seen.has(commandId) || !inRange(entry.createdAt)) continue;
      seen.add(commandId);
      included = true;
      group.turns++;
      if (history) {
        // 修复原因：请求 Token 可以按时间补回，但用户轮次仅能关联到真实完成边界；
        // 缺日期、计数重置和未完成的原生轮次不能声称为整轮已计量。
        if (measuredNativeTurn!(entry.createdAt, nextTimes[index]!)) group.measuredTurns++;
        else group.unknownTurns++;
      } else {
        const fact = facts.get(commandId);
        if (fact) {
          group.measuredTurns++;
          addUsage(group, fact, fact.models, entry.createdAt ?? null, formatter, hourly);
        } else group.unknownTurns++;
      }
    }
    if (included) {
      group.sessions++;
      groups.set(session.agent, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

function addUsage(
  group: AcpAppUsageAgent,
  usage: AcpTokenUsage,
  models: AcpAppUsageAgent["models"],
  timestamp: number | null,
  formatter: Intl.DateTimeFormat,
  hourly: ReturnType<typeof createAppUsageHourlyAccumulator>,
): void {
  group.totalTokens += usage.totalTokens;
  group.inputTokens += usage.inputTokens;
  group.outputTokens += usage.outputTokens;
  for (const model of models) {
    const previous = group.models.find((item) => item.modelId === model.modelId);
    if (!previous) group.models.push({ ...model });
    else {
      previous.totalTokens += model.totalTokens;
      previous.inputTokens += model.inputTokens;
      previous.outputTokens += model.outputTokens;
      for (const key of ["cacheReadTokens", "cacheWriteTokens"] as const) {
        if (previous[key] !== undefined && model[key] !== undefined) previous[key] += model[key];
        else delete previous[key];
      }
    }
  }
  const unknown = usage.totalTokens - models.reduce((sum, model) => sum + model.totalTokens, 0);
  hourly.add(
    timestamp,
    unknown > 0 ? [...models, { modelId: null, totalTokens: unknown }] : models,
  );
  if (timestamp === null) return;
  const parts = formatter.formatToParts(timestamp);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const daily = group.dailyUsage ?? (group.dailyUsage = []);
  let day = daily.find((item) => item.date === date);
  if (!day) {
    day = { date, models: [] };
    daily.push(day);
    daily.sort((a, b) => a.date.localeCompare(b.date));
  }
  const addModel = (modelId: string | null, totalTokens: number) => {
    const previous = day!.models.find((item) => item.modelId === modelId);
    if (previous) previous.totalTokens += totalTokens;
    else day!.models.push({ modelId, totalTokens });
  };
  for (const model of models) addModel(model.modelId, model.totalTokens);
  if (unknown > 0) addModel(null, unknown);
}

function cacheDelta(
  current: NonNullable<AcpSession["usageBaseline"]>,
  previous: AcpSession["usageBaseline"],
) {
  const result: { cacheReadTokens?: number; cacheWriteTokens?: number } = {};
  for (const key of ["cacheReadTokens", "cacheWriteTokens"] as const) {
    const now = current[key];
    const before = previous ? previous[key] : 0;
    // 修复原因：旧基线缺少缓存维度时不能把整段累计误记成这一轮缓存消耗。
    if (now !== undefined && before !== undefined && now >= before) result[key] = now - before;
  }
  return result;
}
