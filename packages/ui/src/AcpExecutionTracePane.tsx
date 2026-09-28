import { useCallback, useEffect, useState } from "react";
import type { AcpDiagnosticEvent } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

/** Host metadata log projection; never synthesizes Agent-internal model I/O. */
export function AcpExecutionTracePane({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  onClose,
}: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const services = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const [events, setEvents] = useState<AcpDiagnosticEvent[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    setError(false);
    // 修复原因：轨迹路径由当前 workspace 的目标 Host 解析，切换 tab/会话后旧 RPC 不能覆盖新列表。
    void services.acpService
      .getExecutionTrace({
        id: sessionId,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      })
      .then((value) => {
        if (!disposed) setEvents(value);
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setError(true);
          logger.warn("[acp-trace] 读取执行轨迹失败", { error: failure });
        }
      });
    return () => {
      disposed = true;
    };
  }, [services, sessionId, workspacePath, workspaceIdentity, remoteSessionId, revision]);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-panel text-foreground"
      data-testid="acp-execution-trace"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-ui-base font-medium">{intl.formatMessage({ id: "acpTrace.title" })}</h2>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={refresh}>
            {intl.formatMessage({ id: "acpTrace.refresh" })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={intl.formatMessage(
              { id: "sidePane.closeTab" },
              { title: intl.formatMessage({ id: "acpTrace.title" }) },
            )}
          >
            ×
          </Button>
        </div>
      </header>
      <p className="px-3 py-2 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "acpTrace.description" })}
      </p>
      <div className="min-h-0 overflow-auto px-3 pb-3 text-ui-sm">
        {error ? (
          <p role="alert">{intl.formatMessage({ id: "acpTrace.loadFailed" })}</p>
        ) : events.length === 0 ? (
          <p>{intl.formatMessage({ id: "acpTrace.empty" })}</p>
        ) : (
          <ol className="space-y-1">
            {events.map((event, index) => (
              <li
                key={`${index}:${event.timestamp}`}
                className="rounded-md bg-surface px-2 py-1 font-mono"
              >
                <time dateTime={new Date(event.timestamp).toISOString()}>
                  {new Date(event.timestamp).toLocaleString()}
                </time>
                {" · "}
                {intl.formatMessage({ id: `acpTrace.event.${event.kind}` })}
                {event.status
                  ? ` · ${intl.formatMessage({ id: `acpTrace.status.${event.status}` })}`
                  : ""}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
