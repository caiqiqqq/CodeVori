import { useCallback, useState } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpSession } from "@zcode/shared";
import type { BackgroundWorkSummary } from "@zcode/shared/zcode-protocol-v4";
import { logger } from "@/logger.js";

/** Only local selection lives here; process/output facts stay in the Host snapshot. */
export function useAcpTerminalPanel(service: IAcpService, session: AcpSession | null) {
  const [selection, setSelection] = useState<{ scope: string; workId: string } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const scope = JSON.stringify([
    session?.workspaceIdentity?.trim() || session?.workspacePath,
    session?.workspacePath,
    session?.remoteSessionId,
    session?.id,
  ]);
  const open = useCallback(
    (work: BackgroundWorkSummary) => {
      setSelection({ scope, workId: work.workId });
      setFailure(null);
    },
    [scope],
  );
  const close = useCallback(() => setSelection(null), []);
  const stop = useCallback(
    (workId: string) => {
      if (!session || !workId.startsWith("acp-terminal:")) return;
      const terminalId = workId.slice("acp-terminal:".length);
      if (!session.terminals?.some((t) => t.terminalId === terminalId && t.status === "running"))
        return;
      setFailure(null);
      void service
        .stopTerminal({
          workspacePath: session.workspacePath,
          workspaceIdentity: session.workspaceIdentity,
          remoteSessionId: session.remoteSessionId,
          id: session.id,
          terminalId,
        })
        .catch(() => {
          logger.warn("ACP terminal stop failed");
          setFailure({ scope, message: "acp.terminalStopFailed" });
        });
    },
    [scope, service, session],
  );
  const workId = selection?.scope === scope ? selection.workId : null;
  const terminal = workId?.startsWith("acp-terminal:")
    ? session?.terminals?.find((t) => `acp-terminal:${t.terminalId}` === workId)
    : undefined;
  const tool = workId?.startsWith("acp-tool:")
    ? session?.entries.find((e) => e.kind === "tool" && `acp-tool:${e.id}` === workId)
    : undefined;
  return {
    open,
    close,
    stop,
    workId,
    terminal,
    tool: tool?.kind === "tool" ? tool : undefined,
    error: failure?.scope === scope ? failure.message : null,
  };
}
