import { useState, type ReactNode } from "react";
import type { AcpTraceTurn, AcpTraceTool } from "@/lib/acpExecutionTrace.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AcpTraceEvents } from "@/AcpTraceEvents.js";

type Expansion = { open: boolean; revision: number };

function TraceSection({
  title,
  text,
  truncated = false,
  expansion,
}: {
  title: string;
  text?: string;
  truncated?: boolean;
  expansion: Expansion;
}) {
  const { intl } = useZCodeIntl();
  return (
    <AcpTraceDisclosure
      expansion={expansion.revision ? expansion : { ...expansion, open: false }}
      className="min-w-0 rounded-lg border border-border bg-surface p-2"
      title={<span className="font-medium">{title}</span>}
    >
      {text === undefined ? (
        <p className="pt-2 text-foreground-subtle">
          {intl.formatMessage({ id: "acpTrace.notReported" })}
        </p>
      ) : (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm">
          {text || intl.formatMessage({ id: "acpTrace.emptyValue" })}
        </pre>
      )}
      {truncated ? (
        <p className="mt-2 text-foreground-subtle">
          {intl.formatMessage({ id: "acpTrace.detailTruncated" })}
        </p>
      ) : null}
    </AcpTraceDisclosure>
  );
}

function Duration({ value }: { value: number | null }) {
  const { intl } = useZCodeIntl();
  return (
    <span className="font-mono text-foreground-subtle">
      {value === null
        ? intl.formatMessage({ id: "acpTrace.durationUnknown" })
        : intl.formatMessage({ id: "acpTrace.duration" }, { seconds: (value / 1000).toFixed(2) })}
    </span>
  );
}

export function AcpTraceDisclosure({
  title,
  children,
  expansion,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  expansion: Expansion;
  className: string;
}) {
  const [local, setLocal] = useState<{ revision: number; open: boolean }>();
  const open = local?.revision === expansion.revision ? local.open : expansion.open;
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open)
          setLocal({ revision: expansion.revision, open: event.currentTarget.open });
      }}
    >
      <summary className="cursor-pointer select-none">{title}</summary>
      {children}
    </details>
  );
}

function ToolCard({
  tool,
  expansion,
}: {
  tool: AcpTraceTool;
  expansion: { open: boolean; revision: number };
}) {
  const { intl } = useZCodeIntl();
  const status = ["pending", "in_progress", "completed", "failed"].includes(tool.entry.status)
    ? tool.entry.status
    : "unknown";
  return (
    <AcpTraceDisclosure
      expansion={expansion}
      className="min-w-0 rounded-lg border border-border p-2"
      title={
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 align-middle">
          <span className="min-w-0 break-words font-medium">{tool.entry.title}</span>
          <span className={status === "failed" ? "text-destructive" : "text-foreground-subtle"}>
            {intl.formatMessage({ id: `acpTrace.status.${status}` })}
          </span>
          <Duration value={tool.durationMs} />
        </span>
      }
    >
      <div className="mt-2 space-y-2">
        {tool.entry.toolName || tool.entry.toolKind ? (
          <p className="break-all text-foreground-subtle">
            {[
              tool.entry.toolName,
              tool.entry.toolKind
                ? intl.formatMessage({ id: `acpTrace.toolKind.${tool.entry.toolKind}` })
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <TraceSection
          expansion={expansion}
          title={intl.formatMessage({ id: "acpTrace.toolInput" })}
          text={tool.entry.input}
          truncated={tool.entry.inputTruncated}
        />
        <TraceSection
          expansion={expansion}
          title={intl.formatMessage({ id: "acpTrace.toolOutput" })}
          text={tool.entry.output ?? tool.entry.content}
          truncated={
            tool.entry.output !== undefined
              ? tool.entry.outputTruncated
              : tool.entry.contentTruncated
          }
        />
        {tool.entry.output !== undefined &&
        tool.entry.content &&
        tool.entry.output !== tool.entry.content ? (
          <TraceSection
            expansion={expansion}
            title={intl.formatMessage({ id: "acpTrace.toolContent" })}
            text={tool.entry.content}
            truncated={tool.entry.contentTruncated}
          />
        ) : null}
        <AcpTraceEvents events={tool.events} />
      </div>
    </AcpTraceDisclosure>
  );
}

export function AcpTraceTurnCard({
  turn,
  expansion,
}: {
  turn: AcpTraceTurn;
  expansion: { open: boolean; revision: number };
}) {
  const { intl, locale } = useZCodeIntl();
  const message = (id: string) => intl.formatMessage({ id });
  const response = turn.entries
    .filter((entry) => entry.kind === "assistant")
    .map((entry) => entry.text)
    .join("\n\n");
  return (
    <div data-acp-trace-turn={turn.entryIndex}>
      <AcpTraceDisclosure
        expansion={expansion}
        className="min-w-0 rounded-xl border border-border bg-card p-3"
        title={
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 align-middle">
            <span className="font-medium">
              {intl.formatMessage({ id: "acpTrace.turn" }, { index: turn.index })}
            </span>
            <span
              className={turn.state === "failed" ? "text-destructive" : "text-foreground-subtle"}
            >
              {message(`acpTrace.turnState.${turn.state}`)}
            </span>
            <Duration value={turn.durationMs} />
          </span>
        }
      >
        <div className="mt-3 space-y-2">
          {turn.user.createdAt ? (
            <time
              dateTime={new Date(turn.user.createdAt).toISOString()}
              className="font-mono text-foreground-subtle"
            >
              {new Date(turn.user.createdAt).toLocaleString(locale)}
            </time>
          ) : null}
          {turn.user.traceSelections?.length ? (
            <p className="break-words text-foreground-subtle">
              {turn.user.traceSelections
                .map((selection) => `${selection.name}: ${selection.value}`)
                .join(" · ")}
            </p>
          ) : null}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
            {turn.user.text || message("acpTrace.attachmentPrompt")}
          </pre>
          {turn.user.attachmentNames?.length ? (
            <p className="break-words text-foreground-subtle">
              {turn.user.attachmentNames.join(" · ")}
            </p>
          ) : null}
          {turn.error ? (
            <p className="whitespace-pre-wrap break-words text-destructive">{turn.error}</p>
          ) : null}
          {turn.tools.map((tool) => (
            <ToolCard key={tool.entryIndex} tool={tool} expansion={expansion} />
          ))}
          <TraceSection
            expansion={expansion}
            title={message("acpTrace.response")}
            text={response || undefined}
          />
          {turn.usage ? (
            <p className="text-foreground-subtle">
              {intl.formatMessage(
                { id: "acpTrace.usage" },
                {
                  input: turn.usage.inputTokens,
                  output: turn.usage.outputTokens,
                  total: turn.usage.totalTokens,
                },
              )}
            </p>
          ) : null}
          {turn.events.length ? (
            <AcpTraceDisclosure
              expansion={expansion.revision ? expansion : { ...expansion, open: false }}
              className="pt-1 text-foreground-subtle"
              title={message("acpTrace.lifecycle")}
            >
              <AcpTraceEvents events={turn.events} />
            </AcpTraceDisclosure>
          ) : (
            <p className="text-foreground-subtlest">{message("acpTrace.legacyTurn")}</p>
          )}
        </div>
      </AcpTraceDisclosure>
    </div>
  );
}
