import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProjectEnvironment, ProjectEnvironmentScope } from "@zcode/shared";
import type { CredentialVaultEntry } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ProjectEnvironmentEditorDialog,
  type ProjectEnvironmentEditorDraft,
  type ProjectEnvironmentResourceDraft,
} from "./ProjectEnvironmentEditorDialog.js";

type Environment = ProjectEnvironment["environment"];
type ResourceDraft = ProjectEnvironmentResourceDraft;
type EditorDraft = ProjectEnvironmentEditorDraft;

function environmentLabel(environment: Environment, label: (id: string) => string) {
  return label(`settings.credentials.environment.${environment}`);
}

export function ProjectEnvironmentSection({
  workspacePath,
  workspaceIdentity,
  credentials,
}: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  credentials: CredentialVaultEntry[];
}) {
  const { intl } = useZCodeIntl();
  const {
    listEnvironments,
    saveEnvironment,
    deleteEnvironment,
    onEnvironmentsChanged,
    environmentsAvailable,
  } = useCredentialVault();
  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const scope = useMemo<ProjectEnvironmentScope | null>(
    () =>
      workspacePath ? { workspacePath, ...(workspaceIdentity ? { workspaceIdentity } : {}) } : null,
    [workspaceIdentity, workspacePath],
  );
  const identity = scope?.workspaceIdentity?.trim() || scope?.workspacePath;
  const scopeKey = identity ?? null;
  const availableCredentials = useMemo(
    () =>
      credentials.filter(
        (entry) => entry.workspaceIdentity === null || entry.workspaceIdentity === identity,
      ),
    [credentials, identity],
  );
  const [profiles, setProfiles] = useState<ProjectEnvironment[]>([]);
  const [loading, setLoading] = useState(Boolean(scope));
  const [errorId, setErrorId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [deleting, setDeleting] = useState<ProjectEnvironment | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const activeScopeKey = useRef(scopeKey);
  const generation = useRef(0);
  activeScopeKey.current = scopeKey;

  const refresh = useCallback(async () => {
    if (activeScopeKey.current !== scopeKey) return;
    const request = ++generation.current;
    if (!scope) {
      setProfiles([]);
      setLoading(false);
      setLoadedScopeKey(null);
      return;
    }
    setLoading(true);
    setErrorId(null);
    try {
      const next = await listEnvironments(scope);
      if (request !== generation.current || activeScopeKey.current !== scopeKey) return;
      setProfiles(next);
      setLoadedScopeKey(scopeKey);
    } catch {
      if (request === generation.current && activeScopeKey.current === scopeKey) {
        setProfiles([]);
        setLoadedScopeKey(scopeKey);
        setErrorId("settings.projectEnvironments.error.load");
      }
    } finally {
      if (request === generation.current && activeScopeKey.current === scopeKey) setLoading(false);
    }
  }, [listEnvironments, scope, scopeKey]);

  useEffect(() => {
    setEditor(null);
    setDeleting(null);
    setSaving(false);
    setErrorId(null);
    if (!scope) {
      setProfiles([]);
      setLoading(false);
      setLoadedScopeKey(null);
      return;
    }
    void refresh();
    let subscription: { dispose(): void } | undefined;
    try {
      subscription = onEnvironmentsChanged(scope, () => {
        void refresh();
      });
    } catch {
      // Older Hosts simply have no subscription capability.
    }
    return () => {
      generation.current += 1;
      subscription?.dispose();
    };
  }, [onEnvironmentsChanged, refresh, scope]);

  const openCreate = () =>
    setEditor({ name: "", environment: "development", instructions: "", resources: [] });
  const openEdit = (profile: ProjectEnvironment) =>
    setEditor({
      profile,
      name: profile.name,
      environment: profile.environment,
      instructions: profile.instructions,
      resources: profile.resources.map(({ credentialId, purpose, instructions }) => ({
        credentialId,
        purpose,
        instructions,
      })),
    });
  const changeResource = (credentialId: string, checked: boolean) => {
    setEditor((current) => {
      if (!current) return current;
      if (!checked)
        return {
          ...current,
          resources: current.resources.filter((resource) => resource.credentialId !== credentialId),
        };
      const credential = availableCredentials.find((entry) => entry.id === credentialId);
      if (
        !credential ||
        current.resources.some((resource) => resource.credentialId === credentialId)
      )
        return current;
      return {
        ...current,
        resources: [
          ...current.resources,
          { credentialId, purpose: credential.name, instructions: "" },
        ],
      };
    });
  };
  const updateResource = (credentialId: string, updates: Partial<ResourceDraft>) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            resources: current.resources.map((resource) =>
              resource.credentialId === credentialId ? { ...resource, ...updates } : resource,
            ),
          }
        : current,
    );
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scope || !editor) return;
    const requestScopeKey = scopeKey;
    setSaving(true);
    setErrorId(null);
    try {
      await saveEnvironment({
        ...scope,
        ...(editor.profile ? { id: editor.profile.id } : {}),
        name: editor.name,
        environment: editor.environment,
        instructions: editor.instructions,
        resources: editor.resources,
        expectedRevision: editor.profile?.revision ?? 0,
      });
      if (activeScopeKey.current === requestScopeKey) setEditor(null);
      await refresh();
    } catch {
      if (activeScopeKey.current === requestScopeKey)
        setErrorId("settings.projectEnvironments.error.save");
    } finally {
      if (activeScopeKey.current === requestScopeKey) setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!scope || !deleting) return;
    const requestScopeKey = scopeKey;
    setSaving(true);
    setErrorId(null);
    try {
      await deleteEnvironment({ ...scope, id: deleting.id, expectedRevision: deleting.revision });
      if (activeScopeKey.current === requestScopeKey) setDeleting(null);
      await refresh();
    } catch {
      if (activeScopeKey.current === requestScopeKey)
        setErrorId("settings.projectEnvironments.error.delete");
    } finally {
      if (activeScopeKey.current === requestScopeKey) setSaving(false);
    }
  };

  if (!environmentsAvailable) return null;

  return (
    <section
      className="space-y-4 border-t border-border pt-5"
      aria-labelledby="project-environments-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="project-environments-heading"
            className="text-ui-base font-semibold text-foreground"
          >
            {label("settings.projectEnvironments.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-ui-sm leading-5 text-foreground-subtle">
            {label(
              scope
                ? "settings.projectEnvironments.description"
                : "settings.projectEnvironments.noProject",
            )}
          </p>
        </div>
        {scope ? (
          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            disabled={loading || loadedScopeKey !== scopeKey}
          >
            <Plus aria-hidden="true" />
            {label("settings.projectEnvironments.add")}
          </Button>
        ) : null}
      </div>

      {errorId ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {label(errorId)}
        </p>
      ) : null}
      {loading || loadedScopeKey !== scopeKey ? (
        <p className="py-4 text-ui-sm text-foreground-subtle">
          {label("settings.projectEnvironments.loading")}
        </p>
      ) : scope && profiles.length === 0 ? (
        <p className="border-y border-border py-5 text-center text-ui-sm text-foreground-subtle">
          {label("settings.projectEnvironments.empty")}
        </p>
      ) : profiles.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {profiles.map((profile) => {
            const missingCount = profile.resources.filter(
              (resource) =>
                !availableCredentials.some((entry) => entry.id === resource.credentialId),
            ).length;
            return (
              <li
                key={profile.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-ui-base font-medium text-foreground">
                      {profile.name}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">
                      {environmentLabel(profile.environment, label)}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">
                      {label("settings.projectEnvironments.resourcesCount").replace(
                        "{count}",
                        String(profile.resources.length),
                      )}
                    </span>
                    {missingCount ? (
                      <span className="text-ui-xs text-destructive">
                        {label("settings.projectEnvironments.unavailableCount").replace(
                          "{count}",
                          String(missingCount),
                        )}
                      </span>
                    ) : null}
                  </div>
                  {profile.instructions ? (
                    <p className="mt-1 line-clamp-2 text-ui-sm text-foreground-subtle">
                      {profile.instructions}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label("settings.projectEnvironments.edit")}
                    title={label("settings.projectEnvironments.edit")}
                    onClick={() => openEdit(profile)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label("settings.projectEnvironments.delete")}
                    title={label("settings.projectEnvironments.delete")}
                    onClick={() => setDeleting(profile)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ProjectEnvironmentEditorDialog
        draft={editor}
        credentials={availableCredentials}
        saving={saving}
        onDraftChange={setEditor}
        onClose={() => setEditor(null)}
        onSubmit={save}
        onToggleResource={changeResource}
        onUpdateResource={updateResource}
      />

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label("settings.projectEnvironments.confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {label("settings.projectEnvironments.confirmDeleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={saving}
            >
              {label("settings.credentials.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={saving}
            >
              {label(
                saving
                  ? "settings.projectEnvironments.deleting"
                  : "settings.projectEnvironments.delete",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
