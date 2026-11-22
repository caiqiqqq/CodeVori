import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import { CredentialEntryList } from "./CredentialEntryList.js";
import { CredentialScopeNavigator } from "./CredentialScopeNavigator.js";
import { useCredentialScope, type CredentialScopeProject } from "@/hooks/useCredentialScope.js";
import {
  CredentialVaultEntryDialog,
  type CredentialVaultDialogMode,
} from "./CredentialVaultEntryDialog.js";

function environmentLabel(environment: CredentialVaultEnvironment, label: (id: string) => string) {
  return label(`settings.credentials.environment.${environment}`);
}

export function CredentialVaultSection({
  initialWorkspacePath,
  initialWorkspaceIdentity,
  projects,
}: {
  initialWorkspacePath: string | null;
  initialWorkspaceIdentity?: string | null;
  projects: Array<Omit<CredentialScopeProject, "identity">>;
}) {
  const { intl } = useZCodeIntl();
  const {
    list,
    listGlobal,
    listUnassigned,
    listAttachable,
    attach,
    attachGlobal,
    detach,
    detachGlobal,
  } = useCredentialVault();
  const {
    projects: visibleProjects,
    selectedProject,
    setSelectedScope,
    isGlobalSelected,
    selectionKey,
    pending,
    loading: projectsLoading,
  } = useCredentialScope({ projects, initialWorkspacePath, initialWorkspaceIdentity });
  const projectIdentity = selectedProject?.identity ?? "";
  const [projectEntries, setProjectEntries] = useState<CredentialVaultEntry[]>([]);
  const [globalEntries, setGlobalEntries] = useState<CredentialVaultEntry[]>([]);
  const [availableEntries, setAvailableEntries] = useState<CredentialVaultEntry[]>([]);
  const [entriesScope, setEntriesScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [mutationErrorId, setMutationErrorId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<CredentialVaultDialogMode | null>(null);
  const refreshVersion = useRef(0);
  const activeSelectionKey = useRef(selectionKey);
  activeSelectionKey.current = selectionKey;

  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    setErrorId(null);
    if (pending) return;
    try {
      const [scoped, available] = await Promise.all([
        selectedProject ? list(projectIdentity) : listGlobal(),
        selectedProject ? listAttachable(projectIdentity) : listUnassigned(),
      ]);
      // 切换项目或 Global 后，旧读取结果不能覆盖当前凭据列表。
      if (refreshVersion.current === version) {
        setProjectEntries(scoped.filter((entry) => entry.scope === "project"));
        setGlobalEntries(scoped.filter((entry) => entry.scope === "global"));
        setAvailableEntries(available);
        setEntriesScope(selectionKey);
      }
    } catch {
      if (refreshVersion.current === version) setErrorId("settings.credentials.error.load");
    } finally {
      if (refreshVersion.current === version) setLoading(false);
    }
  }, [
    list,
    listAttachable,
    listGlobal,
    listUnassigned,
    projectIdentity,
    pending,
    selectedProject,
    selectionKey,
  ]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const refreshLatest = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // 项目切换后关闭旧项目的编辑上下文，避免继续操作上一项目的凭证。
    setDialogMode(null);
  }, [selectionKey]);

  const openCreate = () => setDialogMode({ kind: "create" });
  const openEdit = (entry: CredentialVaultEntry) => setDialogMode({ kind: "edit", entry });
  const openDelete = (entry: CredentialVaultEntry) => setDialogMode({ kind: "delete", entry });
  const kindLabel = (kind: CredentialVaultKind) => label(`settings.credentials.kind.${kind}`);
  const visibleProjectEntries = entriesScope === selectionKey ? projectEntries : [];
  const visibleGlobalEntries = entriesScope === selectionKey ? globalEntries : [];
  const visibleAvailableEntries = entriesScope === selectionKey ? availableEntries : [];
  const visibleUnassignedEntries = visibleAvailableEntries.filter(
    (entry) => entry.scope === "unassigned",
  );
  const visibleShareableEntries = visibleAvailableEntries.filter(
    (entry) => entry.scope === "project",
  );
  const runAttachment = async (
    entry: CredentialVaultEntry,
    operation: () => Promise<void>,
    failureId: string,
  ) => {
    const operationSelection = selectionKey;
    setMutatingId(entry.id);
    setMutationErrorId(null);
    try {
      await operation();
      if (activeSelectionKey.current === operationSelection) await refresh();
    } catch {
      setMutationErrorId(failureId);
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-label={label("settings.credentials.title")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-ui-base leading-6 text-foreground-subtle">
          {label("settings.credentials.description")}
        </p>
        <Button type="button" size="sm" className="shrink-0" onClick={openCreate}>
          <Plus aria-hidden="true" />
          {label("settings.credentials.add")}
        </Button>
      </div>

      {errorId ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {label(errorId)}
        </p>
      ) : null}
      {mutationErrorId ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {label(mutationErrorId)}
        </p>
      ) : null}

      <div className="grid items-start gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <CredentialScopeNavigator
          projects={visibleProjects}
          loading={projectsLoading}
          selectedProjectIdentity={projectIdentity}
          isGlobalSelected={isGlobalSelected}
          label={label}
          onGlobalSelect={() => setSelectedScope({ kind: "global" })}
          onProjectSelect={(identity) => setSelectedScope({ kind: "project", identity })}
        />

        <div className="min-w-0 space-y-6">
          {isGlobalSelected ? (
            <section aria-labelledby="credential-global-heading" className="space-y-2">
              <h3
                id="credential-global-heading"
                className="px-1 text-ui-base font-semibold text-foreground"
              >
                {label("settings.credentials.globalEntries")}
              </h3>
              {loading ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : visibleGlobalEntries.length === 0 ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.globalEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleGlobalEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  onEdit={openEdit}
                  onDetach={(entry) =>
                    void runAttachment(
                      entry,
                      () => detachGlobal(entry.id),
                      "settings.credentials.error.detachGlobal",
                    )
                  }
                  detachLabel={label("settings.credentials.detachGlobal")}
                  mutatingId={mutatingId}
                />
              )}
            </section>
          ) : (
            <section aria-labelledby="credential-project-heading" className="space-y-2">
              <h3
                id="credential-project-heading"
                className="px-1 text-ui-base font-semibold text-foreground"
              >
                {intl.formatMessage(
                  { id: "settings.credentials.projectEntries" },
                  { project: selectedProject?.label ?? "" },
                )}
              </h3>
              {loading ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : !selectedProject || visibleProjectEntries.length === 0 ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.projectEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleProjectEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  onEdit={openEdit}
                  onDetach={(entry) =>
                    void runAttachment(
                      entry,
                      () => detach(entry.id, projectIdentity),
                      "settings.credentials.error.detach",
                    )
                  }
                  detachLabel={label("settings.credentials.detach")}
                  mutatingId={mutatingId}
                />
              )}
            </section>
          )}

          <section aria-labelledby="credential-available-heading" className="space-y-2">
            <h3
              id="credential-available-heading"
              className="px-1 text-ui-base font-semibold text-foreground"
            >
              {label("settings.credentials.availableEntries")}
            </h3>
            {loading ? (
              <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                {label("settings.credentials.loading")}
              </p>
            ) : visibleUnassignedEntries.length === 0 ? (
              <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                {label("settings.credentials.availableEmpty")}
              </p>
            ) : (
              <CredentialEntryList
                entries={visibleUnassignedEntries}
                label={label}
                kindLabel={kindLabel}
                environmentLabel={(environment) => environmentLabel(environment, label)}
                onEdit={openEdit}
                onDelete={openDelete}
                onAttach={(entry) =>
                  isGlobalSelected
                    ? void runAttachment(
                        entry,
                        () => attachGlobal(entry.id),
                        "settings.credentials.error.attachGlobal",
                      )
                    : selectedProject
                      ? void runAttachment(
                          entry,
                          () => attach(entry.id, projectIdentity),
                          "settings.credentials.error.attach",
                        )
                      : undefined
                }
                attachLabel={label(
                  isGlobalSelected
                    ? "settings.credentials.attachGlobal"
                    : "settings.credentials.attach",
                )}
                mutatingId={mutatingId}
              />
            )}
          </section>

          {selectedProject ? (
            <section aria-labelledby="credential-shareable-heading" className="space-y-2">
              <h3
                id="credential-shareable-heading"
                className="px-1 text-ui-base font-semibold text-foreground"
              >
                {label("settings.credentials.shareableEntries")}
              </h3>
              {loading ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : visibleShareableEntries.length === 0 ? (
                <p className="rounded-xl bg-surface px-4 py-5 text-ui-sm leading-6 text-foreground-subtle">
                  {label("settings.credentials.shareableEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleShareableEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  readOnlyLabel={label("settings.credentials.sharedElsewhere")}
                  onAttach={(entry) =>
                    void runAttachment(
                      entry,
                      () => attach(entry.id, projectIdentity),
                      "settings.credentials.error.attach",
                    )
                  }
                  attachLabel={label("settings.credentials.attach")}
                  mutatingId={mutatingId}
                />
              )}
            </section>
          ) : null}
        </div>
      </div>

      <CredentialVaultEntryDialog
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onChanged={refreshLatest}
      />
    </section>
  );
}
