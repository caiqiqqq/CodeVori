import { acpAgentDefinition, type AcpAppUsageAgent } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  formatCompactNumber,
  formatSummaryCompactTokenUsage,
} from "@/settings/usage-stats/usageStatsUiParts.js";

export function AcpUsageSourceDetails({ agent }: { agent: AcpAppUsageAgent }) {
  const { intl, locale } = useZCodeIntl();
  const items = [
    [
      "settings.usage.lifetimeTotalTokens",
      formatSummaryCompactTokenUsage(locale, agent.totalTokens),
    ],
    ["settings.usage.sessions", formatCompactNumber(locale, agent.sessions)],
    ["settings.usage.acpTurns", formatCompactNumber(locale, agent.turns)],
    ["settings.usage.measuredTurns", formatCompactNumber(locale, agent.measuredTurns)],
    ["settings.usage.unknownTurns", formatCompactNumber(locale, agent.unknownTurns)],
  ] as const;
  return (
    <section
      className="space-y-3 rounded-xl bg-surface p-4"
      data-testid={`app-usage-agent-detail-${agent.agent}`}
    >
      <h3 className="text-ui-base font-medium text-foreground">
        {acpAgentDefinition(agent.agent).name}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-ui-lg font-medium text-foreground">{value}</div>
            <div className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: label })}
            </div>
          </div>
        ))}
      </div>
      {agent.models.length ? (
        <div className="space-y-2 border-t border-border pt-3" data-testid="app-usage-acp-models">
          <h4 className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.acpModels" })}
          </h4>
          {[...agent.models]
            .sort((a, b) => b.totalTokens - a.totalTokens)
            .map((model) => (
              <div
                key={model.modelId}
                className="flex flex-wrap items-center justify-between gap-2 text-ui-sm"
              >
                <span className="min-w-0 truncate">{model.modelId}</span>
                <span className="font-mono">
                  {formatSummaryCompactTokenUsage(locale, model.totalTokens)}{" "}
                  {intl.formatMessage({ id: "settings.usage.tokenUnit" })}
                </span>
              </div>
            ))}
        </div>
      ) : null}
      {agent.models.reduce((sum, model) => sum + model.totalTokens, 0) < agent.totalTokens ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.acpModelUnknown" })}
        </p>
      ) : null}
      {agent.agent === "codex" && agent.unknownTurns > 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.codexUsageUnknown" })}
        </p>
      ) : null}
      {agent.agent !== "codex" && agent.unknownTurns > 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.acpCoverageHint" })}
        </p>
      ) : null}
    </section>
  );
}
