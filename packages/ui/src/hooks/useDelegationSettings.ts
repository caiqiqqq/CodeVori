import { useEffect, useMemo, useRef, useState } from "react";
import { delegationSettingsSchema, type DelegationSettings } from "@zcode/shared";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "./useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { delegationErrorMessage } from "@/delegation/delegationMessages.js";

export function useDelegationSettings(
  workspacePath: string | null,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) {
  const { intl } = useZCodeIntl();
  const base = useBaseWorkspaceServices();
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
  );
  const service = workspacePath
    ? resolution.rpcReady
      ? resolution.services.agentDelegationService
      : undefined
    : base.agentDelegationService;
  const scope = useMemo(
    () => ({
      workspacePath: workspacePath ?? "__global__",
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [workspacePath, workspaceIdentity, remoteSessionId],
  );
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    scope: typeof scope;
    settings: DelegationSettings;
    error: string | null;
  }>();
  const owner = useMemo(() => ({}), [service, scope]);
  const writes = useRef<{ owner: object; settings?: DelegationSettings; pending: Promise<void> }>({
    owner,
    pending: Promise.resolve(),
  });
  if (writes.current.owner !== owner) writes.current = { owner, pending: Promise.resolve() };
  useEffect(() => {
    let disposed = false;
    void service
      ?.getSettings(scope)
      .then((raw) => {
        const settings = delegationSettingsSchema.parse(raw);
        if (!disposed) {
          writes.current.settings = settings;
          setSnapshot({ service, scope, settings, error: null });
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [service, scope]);
  const settings =
    snapshot && snapshot.service === service && snapshot.scope === scope
      ? snapshot.settings
      : undefined;
  const update = (patch: Partial<DelegationSettings>) => {
    if (!service || !settings) return;
    const queue = writes.current;
    // 失焦保存和开关可能连续触发；逐条应用局部草稿，不用过期整份设置覆盖前一次保存。
    queue.pending = queue.pending.then(async () => {
      if (writes.current !== queue || !queue.settings) return;
      const previous = queue.settings;
      const next = { ...previous, ...patch };
      // 深度 1 即不继续委托；复用旧字段，避免 UI 再维护一个与层级矛盾的嵌套开关。
      if (patch.maxDepth !== undefined) next.allowNested = next.maxDepth > 1;
      // 层级与执行容量需原子协调；按串行队列中的最新值计算，避免失焦和开关连续操作保存非法组合。
      if (next.allowNested) {
        if (patch.concurrency !== undefined)
          next.maxDepth = Math.min(next.maxDepth, next.concurrency);
        else next.concurrency = Math.max(next.concurrency, next.maxDepth);
      }
      try {
        await service.updateSettings({ ...scope, ...next });
        if (writes.current !== queue) return;
        queue.settings = next;
        setSnapshot({ service, scope, settings: next, error: null });
      } catch (error) {
        if (writes.current === queue)
          setSnapshot({
            service,
            scope,
            settings: previous,
            error: delegationErrorMessage(error, intl),
          });
      }
    });
    return queue.pending;
  };
  return { settings, update, error: snapshot?.error };
}
