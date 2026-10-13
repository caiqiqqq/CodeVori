import {
  acpAgentDefinition,
  createAppUsageHourlyAccumulator,
  type AppUsageSnapshot,
} from "@zcode/shared";

/** Read-only chart projection; API metrics and ACP request facts remain separate. */
export function projectAppUsageCharts(
  snapshot: AppUsageSnapshot,
  source: string,
  unknownModel = "?",
): AppUsageSnapshot {
  if (source === "native") return snapshot;
  const includeNative = source === "all";
  const agents = (snapshot.acpAgents ?? []).filter(
    (agent) => includeNative || source === `acp:${agent.agent}`,
  );
  const models = new Map<string | null, AppUsageSnapshot["models"][number]>();
  const days = new Map<string, AppUsageSnapshot["dailyModelUsage"][number]>();
  const hourly = createAppUsageHourlyAccumulator(snapshot.timeZone, snapshot.generatedAt).usage;
  // 旧 Host 未提供小时事实时不能把每日总量摊平；跨午夜也不能混合不同日期。
  let hourlySupported = true;
  const addHours = (
    value: AppUsageSnapshot["hourlyModelUsage"],
    label: (id: string | null) => string | null,
  ) => {
    if (!value || value.date !== hourly.date) {
      hourlySupported = false;
      return;
    }
    for (const hour of value.hours)
      for (const model of hour.models)
        hourly.hours[hour.hour]!.models.push({ ...model, modelId: label(model.modelId) });
  };
  if (includeNative) {
    addHours(snapshot.hourlyModelUsage, (id) => id);
    for (const model of snapshot.models) models.set(model.modelId, { ...model });
    for (const day of snapshot.dailyModelUsage)
      days.set(day.date, { ...day, models: day.models.map((model) => ({ ...model })) });
  }
  let total = includeNative ? snapshot.summary.totalTokens : 0;
  let input = includeNative ? snapshot.summary.inputTokens : 0;
  let output = includeNative ? snapshot.summary.outputTokens : 0;
  for (const agent of agents) {
    const label = (id: string | null) =>
      `${acpAgentDefinition(agent.agent).name} · ${id ?? unknownModel}`;
    addHours(agent.hourlyUsage, label);
    total += agent.totalTokens;
    input += agent.inputTokens;
    output += agent.outputTokens;
    for (const model of agent.models)
      models.set(label(model.modelId), {
        ...model,
        modelId: label(model.modelId),
        requestCount: 0,
        share: 0,
      });
    const unknown =
      agent.totalTokens - agent.models.reduce((sum, model) => sum + model.totalTokens, 0);
    if (unknown > 0)
      models.set(label(null), {
        modelId: label(null),
        totalTokens: unknown,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        share: 0,
      });
    for (const day of agent.dailyUsage ?? []) {
      const current = days.get(day.date) ?? { date: day.date, models: [] };
      for (const model of day.models)
        current.models.push({ ...model, modelId: label(model.modelId) });
      days.set(day.date, current);
    }
  }
  // 修复原因：全部来源此前沿用 API snapshot，Codex 无法进入趋势/饼图；
  // 显式按来源投影，不以 API 默认模型补齐未知归属，不修改原始响应。
  return {
    ...snapshot,
    summary: { ...snapshot.summary, totalTokens: total, inputTokens: input, outputTokens: output },
    models: [...models.values()]
      .map((model) => ({ ...model, share: total > 0 ? model.totalTokens / total : 0 }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    dailyModelUsage: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hourlyModelUsage: hourlySupported ? hourly : undefined,
  };
}
