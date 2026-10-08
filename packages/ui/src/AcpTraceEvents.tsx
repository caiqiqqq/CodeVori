import type { AcpDiagnosticEvent } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AcpTraceEvents({ events }: { events: readonly AcpDiagnosticEvent[] }) {
  const { intl, locale } = useZCodeIntl();
  return (
    <ol className="mt-2 space-y-1 border-l border-border pl-3 text-ui-sm text-foreground-subtle">
      {events.map((event, index) => (
        <li
          key={event.eventId ?? `${index}:${event.timestamp}`}
          className="flex flex-wrap gap-x-2 gap-y-1"
        >
          <time className="font-mono" dateTime={new Date(event.timestamp).toISOString()}>
            {new Date(event.timestamp).toLocaleTimeString(locale, { hour12: false })}
          </time>
          <span>{intl.formatMessage({ id: `acpTrace.event.${event.kind}` })}</span>
          {event.status ? (
            <span>{intl.formatMessage({ id: `acpTrace.status.${event.status}` })}</span>
          ) : null}
          {event.permissionDecision ? (
            <span>
              {intl.formatMessage({ id: `acpTrace.permission.${event.permissionDecision}` })}
            </span>
          ) : null}
          {event.stopReason ? (
            <span>{intl.formatMessage({ id: `acpTrace.stop.${event.stopReason}` })}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
