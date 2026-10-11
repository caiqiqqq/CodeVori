import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkTask, WorkTaskResultCancel, WorkTaskResultSource } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { workTaskErrorMessage } from "@/lib/workTaskBoard.js";

export function useWorkTaskResultDraft(task: WorkTask) {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    task.workspacePath,
    task.remoteSessionId,
    task.workspaceIdentity,
    undefined,
    true,
  );
  const service = services.workTaskService;
  const sessionId = task.session?.id;
  const { locale } = useZCodeIntl();
  const owner = useMemo(
    () => ({}),
    [
      service,
      rpcReady,
      task.id,
      task.runSeq,
      task.status,
      task.workspacePath,
      task.workspaceIdentity,
      task.remoteSessionId,
      sessionId,
    ],
  );
  const current = useRef(owner);
  current.current = owner;
  const pending = useRef<{ owner: object; request: WorkTaskResultCancel } | null>(null);
  const [state, setState] = useState<{ owner: object; loading: boolean; error: string | null }>({
    owner,
    loading: false,
    error: null,
  });
  const [source, setSource] = useState<{
    owner: object;
    value: WorkTaskResultSource | null;
    error: string | null;
  }>({ owner, value: null, error: null });
  const sourceReadVersion = useRef(0);
  useEffect(() => {
    if (!service || !rpcReady || !sessionId || task.workspaceIdentity || task.remoteSessionId)
      return;
    let active = true;
    const version = ++sourceReadVersion.current;
    void service
      .getResultSource({ workspacePath: task.workspacePath, id: task.id, runSeq: task.runSeq })
      .then(
        (value) => {
          if (active && version === sourceReadVersion.current)
            setSource({ owner, value, error: null });
        },
        (error: unknown) => {
          if (active && version === sourceReadVersion.current)
            setSource({ owner, value: null, error: workTaskErrorMessage(error) });
        },
      );
    return () => {
      active = false;
    };
  }, [
    owner,
    service,
    rpcReady,
    task.id,
    task.runSeq,
    task.workspacePath,
    task.workspaceIdentity,
    task.remoteSessionId,
    sessionId,
  ]);
  const cancel = () => {
    const request = pending.current;
    if (!request || request.owner !== owner) return;
    pending.current = null;
    void service?.cancelResult(request.request).catch(() => {});
    setState({ owner, loading: false, error: null });
  };
  useEffect(
    () => () => {
      const request = pending.current;
      if (request?.owner !== owner) return;
      pending.current = null;
      void service?.cancelResult(request.request).catch(() => {});
    },
    [owner, service],
  );
  return {
    source: source.owner === owner ? source.value : null,
    loading: state.owner === owner && state.loading,
    error:
      (state.owner === owner ? state.error : null) ??
      (source.owner === owner ? source.error : null),
    cancel,
    async generate(mode: "merge" | "accept"): Promise<string | null> {
      if (
        pending.current ||
        !service ||
        !rpcReady ||
        task.workspaceIdentity ||
        task.remoteSessionId
      )
        return null;
      const request = {
        workspacePath: task.workspacePath,
        id: task.id,
        runSeq: task.runSeq,
        requestId: crypto.randomUUID(),
      };
      pending.current = { owner, request };
      // 初始来源读取若晚于生成结果返回，不得覆盖实际采用的模型。
      sourceReadVersion.current++;
      setState({ owner, loading: true, error: null });
      try {
        const result = await service.generateResult({ ...request, mode, locale });
        // 草稿只属于发起时的任务/scope/轮次；取消或关闭后的迟到结果不能写回。
        if (current.current !== owner || pending.current?.request.requestId !== request.requestId)
          return null;
        setState({ owner, loading: false, error: null });
        setSource({ owner, value: result.source, error: null });
        return result.text;
      } catch (error) {
        if (current.current === owner && pending.current?.request.requestId === request.requestId)
          setState({ owner, loading: false, error: workTaskErrorMessage(error) });
        return null;
      } finally {
        if (pending.current?.request.requestId === request.requestId) pending.current = null;
      }
    },
  };
}
