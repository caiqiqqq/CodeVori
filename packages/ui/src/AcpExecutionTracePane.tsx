import { useDeferredValue, useMemo, useState } from "react";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { acpAgentDefinition } from "@zcode/shared";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useAcpExecutionTrace } from "@/hooks/useAcpExecutionTrace.js";
import { buildAcpExecutionTrace, filterAcpTraceTurns } from "@/lib/acpExecutionTrace.js";
import { AcpTraceEvents } from "@/AcpTraceEvents.js";
import { AcpTraceDisclosure, AcpTraceTurnCard } from "@/AcpTraceTurnCard.js";

interface Props {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  onClose: () => void;
}

export function AcpExecutionTracePane(props: Props) {
  // 身份切换同步清空查询/展开状态，不能闪现另一 workspace 的轨迹正文。
  return (
    <TracePane
      key={JSON.stringify([
        props.workspaceIdentity?.trim() || props.workspacePath,
        props.remoteSessionId,
        props.sessionId,
      ])}
      {...props}
    />
  );
}

function TracePane({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  onClose,
}: Props) {
  const { intl } = useZCodeIntl();
  const { session, events, loading, error, refresh } = useAcpExecutionTrace(
    workspacePath,
    sessionId,
    workspaceIdentity,
    remoteSessionId,
  );
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [expansion, setExpansion] = useState({ open: true, revision: 0 });
  const deferredQuery = useDeferredValue(query);
  const trace = useMemo(() => buildAcpExecutionTrace(session, events), [session, events]);
  const turns = useMemo(
    () => filterAcpTraceTurns(trace.turns, deferredQuery, failedOnly),
    [trace.turns, deferredQuery, failedOnly],
  );
  const tools = trace.turns.reduce((sum, turn) => sum + turn.tools.length, 0);
  const failures = trace.turns.filter(
    (turn) => turn.state === "failed" || turn.tools.some(({ entry }) => entry.status === "failed"),
  ).length;
  const message = (id: string) => intl.formatMessage({ id });
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-panel text-foreground"
      data-testid="acp-execution-trace"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {session ? <AcpAgentIcon agent={session.agent} /> : null}
          <h2 className="truncate text-ui-base font-medium">{message("acpTrace.title")}</h2>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refresh}
            aria-label={message("acpTrace.refresh")}
            disabled={loading}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={intl.formatMessage(
              { id: "sidePane.closeTab" },
              { title: message("acpTrace.title") },
            )}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </header>
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        {session ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-foreground-subtle">
            <span>{acpAgentDefinition(session.agent).name}</span>
            <span>
              {intl.formatMessage(
                { id: "acpTrace.summary" },
                { turns: trace.turns.length, tools, failures },
              )}
            </span>
            <span role="status">
              {message(loading ? "modelTrajectory.loading" : "acpTrace.live")}
            </span>
          </div>
        ) : null}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={message("acpTrace.search")}
          aria-label={message("acpTrace.search")}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={failedOnly}
              onCheckedChange={(value) => setFailedOnly(value === true)}
            />
            {message("acpTrace.failedOnly")}
          </label>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setExpansion((value) => ({ open: !value.open, revision: value.revision + 1 }))
            }
          >
            {message(expansion.open ? "modelTrajectory.collapseAll" : "modelTrajectory.expandAll")}
          </Button>
        </div>
        <p className="text-ui-sm text-foreground-subtlest">{message("acpTrace.description")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-ui-sm">
        {error ? (
          <p role="alert" className="mb-3 text-destructive">
            {message("acpTrace.loadFailed")}
          </p>
        ) : null}
        {events.length >= 500 || events.some((event) => event.kind === "trace-truncated") ? (
          <p className="mb-3 text-foreground-subtle">{message("acpTrace.truncated")}</p>
        ) : null}
        {loading && !session ? (
          <p>{message("modelTrajectory.loading")}</p>
        ) : turns.length ? (
          <div className="space-y-3">
            {turns.map((turn) => (
              <AcpTraceTurnCard key={turn.entryIndex} turn={turn} expansion={expansion} />
            ))}
          </div>
        ) : !error ? (
          <p className="text-foreground-subtle">
            {message(trace.turns.length ? "acpTrace.noMatches" : "acpTrace.empty")}
          </p>
        ) : null}
        {!query && !failedOnly && trace.uncorrelatedEvents.length ? (
          <AcpTraceDisclosure
            expansion={expansion.revision ? expansion : { ...expansion, open: false }}
            className="mt-3 rounded-xl border border-border p-3 text-foreground-subtle"
            title={message("acpTrace.uncorrelated")}
          >
            <AcpTraceEvents events={trace.uncorrelatedEvents} />
          </AcpTraceDisclosure>
        ) : null}
      </div>
    </section>
  );
}
