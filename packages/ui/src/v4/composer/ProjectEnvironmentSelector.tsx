import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectEnvironment,
  ProjectEnvironmentScope,
  ProjectEnvironmentSession,
  SessionEnvironment,
} from "@zcode/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProjectEnvironmentSelector({
  workspacePath,
  workspaceIdentity,
  sessionId,
  kind,
  busy,
}: ProjectEnvironmentScope & {
  sessionId: string;
  kind: ProjectEnvironmentSession["kind"];
  busy: boolean;
}) {
  const { intl } = useZCodeIntl();
  const {
    listEnvironments,
    getSessionEnvironment,
    setSessionEnvironment,
    onEnvironmentsChanged,
    environmentsAvailable,
  } = useCredentialVault();
  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const projectScope = useMemo<ProjectEnvironmentScope>(
    () => ({ workspacePath, ...(workspaceIdentity ? { workspaceIdentity } : {}) }),
    [workspaceIdentity, workspacePath],
  );
  const sessionScope = useMemo<ProjectEnvironmentSession>(
    () => ({ ...projectScope, kind, sessionId }),
    [kind, projectScope, sessionId],
  );
  const scopeKey = JSON.stringify([
    projectScope.workspaceIdentity?.trim() || projectScope.workspacePath,
    kind,
    sessionId,
  ]);
  const [profiles, setProfiles] = useState<ProjectEnvironment[]>([]);
  const [binding, setBinding] = useState<SessionEnvironment | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [changingRequest, setChangingRequest] = useState<{
    scopeKey: string;
    request: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const changeGeneration = useRef(0);
  const activeScopeKey = useRef(scopeKey);
  activeScopeKey.current = scopeKey;
  const changing = changingRequest?.scopeKey === scopeKey;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [nextProfiles, nextBinding] = await Promise.all([
        listEnvironments(projectScope),
        getSessionEnvironment(sessionScope),
      ]);
      if (request !== generation.current) return;
      setProfiles(nextProfiles);
      setBinding(nextBinding);
      setLoadedScopeKey(scopeKey);
      setError(false);
    } catch {
      if (request === generation.current) {
        setProfiles([]);
        setBinding(null);
        setLoadedScopeKey(scopeKey);
        setError(true);
      }
    }
  }, [getSessionEnvironment, listEnvironments, projectScope, scopeKey, sessionScope]);

  useEffect(() => {
    void refresh();
    let subscription: { dispose(): void } | undefined;
    try {
      subscription = onEnvironmentsChanged(projectScope, () => {
        void refresh();
      });
    } catch {
      // Older Hosts simply have no subscription capability.
    }
    return () => {
      generation.current += 1;
      subscription?.dispose();
    };
  }, [onEnvironmentsChanged, projectScope, refresh]);

  const handleChange = async (environmentId: string) => {
    if (busy || changing || !binding) return;
    const request = ++changeGeneration.current;
    const requestScopeKey = scopeKey;
    setChangingRequest({ scopeKey: requestScopeKey, request });
    setError(false);
    try {
      const next = await setSessionEnvironment({
        ...sessionScope,
        environmentId: environmentId || null,
        expectedRevision: binding.revision,
      });
      if (activeScopeKey.current === requestScopeKey) setBinding(next);
    } catch {
      if (activeScopeKey.current === requestScopeKey) {
        await refresh();
        if (activeScopeKey.current === requestScopeKey) setError(true);
      }
    } finally {
      setChangingRequest((current) => (current?.request === request ? null : current));
    }
  };

  if (loadedScopeKey !== scopeKey) return null;
  const unavailable = Boolean(binding?.environmentId && !binding.environment);
  const value = binding?.environmentId ?? "none";
  const disabled = busy || changing || !binding;

  if (!environmentsAvailable) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="project-environment-selector">
      <span className="sr-only" id={`project-environment-label-${sessionId}`}>
        {label("chat.toolbar.projectEnvironment.label")}
      </span>
      <Select value={value} onValueChange={(next) => void handleChange(next)} disabled={disabled}>
        <SelectTrigger
          size="sm"
          variant="outline"
          className="h-7 max-w-52 min-w-32 gap-1 rounded-md px-2 text-ui-xs"
          aria-labelledby={`project-environment-label-${sessionId}`}
          aria-busy={changing}
          title={label("chat.toolbar.projectEnvironment.label")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="none">{label("chat.toolbar.projectEnvironment.none")}</SelectItem>
          {unavailable ? (
            <SelectItem value={binding!.environmentId!}>
              {label("chat.toolbar.projectEnvironment.unavailable")}
            </SelectItem>
          ) : null}
          {profiles
            .filter((profile) => !unavailable || profile.id !== binding?.environmentId)
            .map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                <span className="block max-w-48 truncate">
                  {profile.name} ·{" "}
                  {label(`settings.credentials.environment.${profile.environment}`)}
                </span>
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {error ? (
        <span
          role="alert"
          className="max-w-32 truncate text-ui-xs text-destructive"
          title={label("chat.toolbar.projectEnvironment.updateError")}
        >
          {label("chat.toolbar.projectEnvironment.updateError")}
        </span>
      ) : null}
    </div>
  );
}
