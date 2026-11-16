import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentSquadSchema,
  delegationAgentsSchema,
  type AgentSquad,
  type AgentSquadSave,
  type AgentSquadDelete,
  type DelegationAgent,
} from "@zcode/shared";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "./useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { delegationErrorMessage } from "@/delegation/delegationMessages.js";

export function useAgentSquads(
  workspacePath: string | null,
  workspaceIdentity?: string,
  enabled = true,
  withTargets = false,
  remoteSessionId?: string,
  remoteTarget?: unknown,
) {
  const base = useBaseWorkspaceServices();
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const candidate = workspacePath
    ? resolution.rpcReady
      ? resolution.services.agentDelegationService
      : undefined
    : base.agentDelegationService;
  const service =
    enabled &&
    !resolution.isRemoteTarget &&
    !remoteTarget &&
    typeof candidate?.listSquads === "function"
      ? candidate
      : undefined;
  const owner = useMemo(
    () => ({}),
    [service, workspacePath, workspaceIdentity, remoteSessionId, withTargets],
  );
  const current = useRef(owner);
  current.current = owner;
  const sequence = useRef(0);
  const [state, setState] = useState<{
    owner: object;
    squads: AgentSquad[];
    targets: DelegationAgent[];
    loading: boolean;
    error: string | null;
  }>({ owner, squads: [], targets: [], loading: true, error: null });
  const { intl } = useZCodeIntl();
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!service) return;
    try {
      const [rows, targets] = await Promise.all([
        service.listSquads(),
        withTargets ? service.targets() : Promise.resolve([]),
      ]);
      if (current.current === owner && request === sequence.current)
        setState({
          owner,
          squads: rows.map((row) => agentSquadSchema.parse(row)),
          targets: delegationAgentsSchema
            .parse(targets)
            .filter((target) => target.kind === "api" || (target.enabled && target.ready)),
          loading: false,
          error: null,
        });
    } catch (error) {
      if (current.current === owner && request === sequence.current)
        setState((previous) => ({
          owner,
          squads: previous.owner === owner ? previous.squads : [],
          targets: previous.owner === owner ? previous.targets : [],
          loading: false,
          error: delegationErrorMessage(error, intl),
        }));
    }
  }, [owner, service, withTargets, intl]);
  useEffect(() => {
    void refresh();
    const listener = service?.onDynamicSquadsChanged?.()(() => {
      void refresh();
    });
    return () => {
      sequence.current++;
      listener?.dispose();
    };
  }, [refresh, service]);
  const [busyOwner, setBusyOwner] = useState<object | null>(null);
  const pending = useRef<object | null>(null);
  const mutate = async (action: () => Promise<unknown>) => {
    if (!service || current.current !== owner || pending.current === owner) return false;
    pending.current = owner;
    setBusyOwner(owner);
    try {
      await action();
      if (current.current === owner) await refresh();
      return current.current === owner;
    } catch (error) {
      if (current.current === owner)
        setState((previous) => ({
          ...previous,
          owner,
          loading: false,
          error: delegationErrorMessage(error, intl),
        }));
      return false;
    } finally {
      if (pending.current === owner) pending.current = null;
      if (current.current === owner) setBusyOwner(null);
    }
  };
  return {
    squads: state.owner === owner ? state.squads : [],
    targets: state.owner === owner ? state.targets : [],
    loading: !!service && (state.owner !== owner || state.loading),
    available: !!service,
    error: state.owner === owner ? state.error : null,
    busy: busyOwner === owner,
    save: (input: AgentSquadSave) => mutate(() => service!.saveSquad(input)),
    remove: (input: AgentSquadDelete) => mutate(() => service!.deleteSquad(input)),
    refresh,
  };
}
