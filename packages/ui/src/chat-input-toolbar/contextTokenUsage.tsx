import type { AcpTokenUsage } from "@zcode/shared";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatContextTokenNumber } from "@/lib/tokenNumberFormat.js";

export type ContextTokenUsageData = {
  source: "native" | "turns";
  measuredTurns?: number;
  usage: AcpTokenUsage | null;
};

/** Token spend is independent of current context occupancy. */
export function ContextTokenUsage({
  data,
  intl,
  locale,
}: {
  data: ContextTokenUsageData;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  locale: string;
}) {
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const usage = data.usage;
  const rate =
    usage && usage.inputTokens > 0 && usage.cacheReadTokens !== undefined
      ? usage.cacheReadTokens / usage.inputTokens
      : null;
  const rows = [
    ["input", usage?.inputTokens],
    ["output", usage?.outputTokens],
    ["cacheRead", usage?.cacheReadTokens],
    ["cacheWrite", usage?.cacheWriteTokens],
    ["total", usage?.totalTokens],
  ] as const;
  return (
    <section className="space-y-2 border-t border-border pt-3" data-testid="context-token-usage">
      <p className="text-ui-sm font-medium text-foreground">
        {intl.formatMessage(
          {
            id: data.source === "native" ? "chat.contextTokens.native" : "chat.contextTokens.turns",
          },
          { count: data.measuredTurns ?? 0 },
        )}
      </p>
      <dl className="space-y-1.5">
        {rows.map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 text-ui-sm"
            data-testid={`context-token-${key}`}
          >
            <dt className="text-foreground-subtle">
              {intl.formatMessage({ id: `chat.contextTokens.${key}` })}
            </dt>
            <dd
              className="font-mono tabular-nums text-foreground"
              title={value === undefined ? undefined : number.format(value)}
            >
              {value === undefined ? "—" : formatContextTokenNumber(value, locale)}
            </dd>
          </div>
        ))}
        <div
          className="flex items-center justify-between gap-3 text-ui-sm"
          data-testid="context-token-hitRate"
        >
          <dt className="text-foreground-subtle">
            {intl.formatMessage({ id: "chat.contextUsage.cacheHitRate" })}
          </dt>
          <dd className="font-mono tabular-nums text-foreground">
            {rate === null ? "—" : percent.format(rate)}
          </dd>
        </div>
      </dl>
      <p className="text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "chat.contextTokens.inputHint" })}
      </p>
    </section>
  );
}
