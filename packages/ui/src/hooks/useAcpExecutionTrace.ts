import { useCallback, useEffect, useState } from "react";
import {
  acpDiagnosticEventSchema,
  acpSessionSchema,
  type AcpDiagnosticEvent,
  type AcpSession,
} from "@zcode/shared";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { mergeAcpTraceEvents } from "@/lib/acpExecutionTrace.js";
import { logger } from "@/logger.js";

export function useAcpExecutionTrace(
  workspacePath: string,
  id: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) {
  const services = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const key = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    workspacePath,
    remoteSessionId,
    id,
  ]);
  const [state, setState] = useState<{
    key: string;
    session: AcpSession | null;
    events: AcpDiagnosticEvent[];
    loading: boolean;
    error: boolean;
  }>({ key, session: null, events: [], loading: true, error: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    let removed = false;
    let session: AcpSession | null = null;
    let events: AcpDiagnosticEvent[] = [];
    const workspace = {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    };
    const publish = (loading = false, error = false) => {
      if (!disposed) setState({ key, session, events, loading, error });
    };
    publish(true);
    const updateSession = (value: AcpSession) => {
      const parsed = acpSessionSchema.parse(value);
      if (!removed && (!session || parsed.revision > session.revision)) session = parsed;
    };
    // 先订阅再并行读取；初始 RPC 迟到时合并实时事实，不能覆盖新 revision 或新轨迹。
    const snapshotSubscription = services.acpService.onDynamicSessionChanged(workspace)(
      (change) => {
        if (
          disposed ||
          (change.kind === "updated" && change.session.id !== id) ||
          (change.kind === "removed" && change.id !== id)
        )
          return;
        if (change.kind === "removed") {
          removed = true;
          session = null;
          events = [];
        } else updateSession(change.session);
        publish(false, removed);
      },
    );
    const traceSubscription = services.acpService.onDynamicExecutionTraceChanged(workspace)(
      (change) => {
        if (disposed || removed || change.id !== id) return;
        events = mergeAcpTraceEvents(events, [acpDiagnosticEventSchema.parse(change.event)]);
        publish();
      },
    );
    void Promise.all([
      services.acpService.read({ ...workspace, id }),
      services.acpService.getExecutionTrace({ ...workspace, id }),
    ])
      .then(([value, trace]) => {
        if (disposed || removed) return;
        updateSession(value);
        events = mergeAcpTraceEvents(
          trace.map((event) => acpDiagnosticEventSchema.parse(event)),
          events,
        );
        publish();
      })
      .catch(() => {
        if (disposed) return;
        publish(false, true);
        // 详情读取可能含用户数据；这里只记录阶段，不把原始异常内容落入应用日志。
        logger.warn("[acp-trace] 读取执行轨迹失败");
      });
    return () => {
      disposed = true;
      snapshotSubscription.dispose();
      traceSubscription.dispose();
    };
  }, [services, key, workspacePath, workspaceIdentity, remoteSessionId, id, revision]);
  // 同一组件切换 scope 后 effect 尚未执行时也不能短暂显示上一会话正文。
  return {
    ...(state.key === key ? state : { session: null, events: [], loading: true, error: false }),
    refresh,
  };
}
