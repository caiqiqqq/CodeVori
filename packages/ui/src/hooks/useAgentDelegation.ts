import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  delegationAgentsSchema,
  type DelegationParent,
  type DelegationTask,
  type DelegationCreate,
  type DelegationFollowUp,
  type DelegationAgent,
} from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";
import { projectAcpSidebarSessions } from "@/lib/acpSidebarSessions.js";
import { requestWorktreeSettingsConversation } from "@/lib/worktreeSettingsNavigation.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { delegationErrorMessage } from "@/delegation/delegationMessages.js";

export function useAgentDelegation(parent: DelegationParent, enabled = true) {
  const { intl } = useZCodeIntl();
  const scope = useMemo(
    () => parent,
    [
      parent.kind,
      parent.sessionId,
      parent.workspacePath,
      parent.workspaceIdentity,
      parent.remoteSessionId,
    ],
  );
  const resolution = useWorkspaceServicesResolution(
    parent.workspacePath,
    parent.remoteSessionId,
    parent.workspaceIdentity,
  );
  const service =
    enabled && resolution.rpcReady ? resolution.services.agentDelegationService : undefined;
  const owner = useMemo(() => ({}), [service, scope]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const available = !!service && !resolution.isRemoteTarget && !!scope.sessionId;
  const [editor, setEditor] = useState<{ owner: object; id: string } | null>(null);
  // 菜单和列表共用会话所有者；切换会话立即隐藏旧草稿，迟到提交也不能关闭新表单。
  const openEditor = useCallback(
    (id: string) => {
      if (available && currentOwner.current === owner) setEditor({ owner, id });
    },
    [available, owner],
  );
  const closeEditor = useCallback(() => {
    if (currentOwner.current === owner) setEditor(null);
  }, [owner]);
  const sequence = useRef(0);
  const [state, setState] = useState<{
    owner: object;
    tasks: DelegationTask[];
    error: string | null;
  }>({ owner, tasks: [], error: null });
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    if (!service || !scope.sessionId) return;
    try {
      const tasks = await service.list(scope);
      if (currentOwner.current === owner && seq === sequence.current)
        setState({ owner, tasks, error: null });
    } catch (error) {
      if (currentOwner.current === owner && seq === sequence.current)
        setState((prev) => ({
          owner,
          tasks: prev.owner === owner ? prev.tasks : [],
          error: delegationErrorMessage(error, intl),
        }));
    }
  }, [owner, scope, service, intl]);
  useEffect(() => {
    void refresh();
    const listener =
      service && scope.sessionId
        ? service.onDynamicChanged(scope)(() => {
            void refresh();
          })
        : undefined;
    return () => {
      sequence.current++;
      listener?.dispose();
    };
  }, [refresh, service, scope]);
  const [busyOwner, setBusyOwner] = useState<object | null>(null);
  const submitting = useRef<object | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    if (currentOwner.current !== owner || submitting.current === owner || !service) return false;
    submitting.current = owner;
    setBusyOwner(owner);
    try {
      await action();
      // 旧会话提交完成不能推进新会话的读取序号；已接受命令仍由服务继续执行。
      if (currentOwner.current !== owner) return true;
      await refresh();
      return true;
    } catch (error) {
      if (currentOwner.current === owner)
        setState((prev) => ({
          owner,
          tasks: prev.owner === owner ? prev.tasks : [],
          error: delegationErrorMessage(error, intl),
        }));
      return false;
    } finally {
      // 会话切换后的旧请求不能锁住新面板，也不能清掉新会话正在提交的状态。
      if (submitting.current === owner) {
        submitting.current = null;
        if (currentOwner.current === owner) setBusyOwner(null);
      }
    }
  };
  const open = (task: DelegationTask) =>
    run(async () => {
      if (!task.session) return;
      const workspacePath = task.worktree?.path ?? task.parent.workspacePath;
      if (task.session.kind === "api")
        requestWorktreeSettingsConversation({
          kind: "api",
          workspacePath,
          taskId: task.session.id,
        });
      else {
        const session = await resolution.services.acpService.read({
          workspacePath,
          id: task.session.id,
        });
        const row = projectAcpSidebarSessions([session], { workspacePath })[0];
        if (row) requestWorktreeSettingsConversation({ kind: "acp", session: row });
      }
    });
  return {
    tasks: state.owner === owner ? state.tasks : [],
    error: state.owner === owner ? state.error : null,
    available,
    editing: available && editor?.owner === owner ? editor.id : null,
    openEditor,
    closeEditor,
    busy: busyOwner === owner,
    open,
    delegate: (input: Omit<DelegationCreate, keyof DelegationParent>) =>
      run(() => service!.delegate({ ...input, ...scope })),
    targets: () => service?.targets() ?? Promise.resolve([]),
    cancel: (id: string) => run(() => service!.cancel({ ...scope, id })),
    cancelAll: () => run(() => service!.cancelAll(scope)),
    retry: (id: string) => run(() => service!.retry({ ...scope, id })),
    resume: (id: string) => run(() => service!.resume({ ...scope, id })),
    followUp: (input: Omit<DelegationFollowUp, keyof DelegationParent>) =>
      run(() => service!.followUp({ ...scope, ...input })),
    redeliver: (id: string, attemptSequence?: number) =>
      run(() => service!.redeliver({ ...scope, id, attemptSequence })),
  };
}

export function useDelegationTargets(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  enabled: boolean,
) {
  const resolution = useWorkspaceServicesResolution(workspacePath, undefined, workspaceIdentity);
  const service = resolution.rpcReady ? resolution.services.agentDelegationService : undefined;
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    targets: DelegationAgent[];
  }>({ service, targets: [] });
  useEffect(() => {
    if (!enabled || !service || resolution.isRemoteTarget) return;
    let disposed = false;
    void service
      .targets()
      .then((targets) => {
        const available = delegationAgentsSchema
          .parse(targets)
          .filter((target) => target.kind === "api" || (target.enabled && target.ready));
        if (!disposed) setSnapshot({ service, targets: available });
      })
      .catch(() => {
        if (!disposed) setSnapshot({ service, targets: [] });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, service, resolution.isRemoteTarget]);
  return enabled && !resolution.isRemoteTarget && snapshot.service === service
    ? snapshot.targets
    : [];
}
