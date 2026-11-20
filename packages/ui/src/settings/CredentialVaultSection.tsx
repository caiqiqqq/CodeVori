import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2, Plus } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import { CredentialEntryList } from "./CredentialEntryList.js";
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
  projects: Array<{
    workspacePath: string;
    workspaceIdentity?: string;
    label: string;
  }>;
}) {
  const { intl } = useZCodeIntl();
  const { list, listGlobal, listUnassigned, attach, attachGlobal, detach, detachGlobal } =
    useCredentialVault();
  const knownProjects = useMemo(() => {
    const unique = new Map<string, { identity: string; label: string; workspacePath: string }>();
    for (const project of projects) {
      const identity = project.workspaceIdentity?.trim() || project.workspacePath.trim();
      if (!identity) continue;
      unique.set(identity, {
        identity,
        label: project.label,
        workspacePath: project.workspacePath,
      });
    }
    return [...unique.values()];
  }, [projects]);
  const initialProjectIdentity = initialWorkspaceIdentity?.trim() || initialWorkspacePath?.trim();
  const [selectedScope, setSelectedScope] = useState<
    { kind: "global" } | { kind: "project"; identity: string }
  >(() =>
    initialProjectIdentity
      ? { kind: "project", identity: initialProjectIdentity }
      : { kind: "global" },
  );
  const selectedProject =
    selectedScope.kind === "project"
      ? (knownProjects.find((project) => project.identity === selectedScope.identity) ?? null)
      : null;
  const isGlobalSelected = selectedScope.kind === "global";
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
  const selectionKey =
    selectedScope.kind === "global" ? "global" : `project:${selectedScope.identity}`;
  const activeSelectionKey = useRef(selectionKey);
  activeSelectionKey.current = selectionKey;

  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  useEffect(() => {
    if (
      selectedScope.kind === "global" ||
      knownProjects.some((project) => project.identity === selectedScope.identity)
    ) {
      return;
    }
    const initialProject = knownProjects.find(
      (project) => project.identity === initialProjectIdentity,
    );
    const fallbackProject = initialProject?.identity ?? knownProjects[0]?.identity;
    setSelectedScope(
      fallbackProject ? { kind: "project", identity: fallbackProject } : { kind: "global" },
    );
  }, [initialProjectIdentity, knownProjects, selectedScope]);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    setErrorId(null);
    try {
      const [scoped, available] = await Promise.all([
        selectedProject ? list(projectIdentity) : listGlobal(),
        listUnassigned(),
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
  }, [list, listGlobal, listUnassigned, projectIdentity, selectedProject, selectionKey]);
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
    <section className="space-y-5" aria-labelledby="credential-vault-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="credential-vault-heading" className="text-ui-lg font-semibold text-foreground">
            {label("settings.credentials.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-ui-base leading-6 text-foreground-subtle">
            {label("settings.credentials.description")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
        <nav aria-label={label("settings.credentials.projectsHeading")} className="min-w-0">
          <h3 className="mb-2 text-ui-base font-medium text-foreground">
            {label("settings.credentials.projectsHeading")}
          </h3>
          <ul className="divide-y divide-border border-y border-border">
            <li>
              <Button
                type="button"
                variant={isGlobalSelected ? "secondary" : "ghost"}
                aria-pressed={isGlobalSelected}
                className="h-auto w-full min-w-0 justify-start rounded-none px-2 py-2 text-left"
                onClick={() => setSelectedScope({ kind: "global" })}
              >
                <Globe2 aria-hidden="true" />
                <span>{label("settings.credentials.globalScope")}</span>
              </Button>
            </li>
            {knownProjects.map((project) => (
              <li key={project.identity}>
                <Button
                  type="button"
                  variant={project.identity === projectIdentity ? "secondary" : "ghost"}
                  aria-pressed={project.identity === projectIdentity}
                  className="h-auto w-full min-w-0 justify-start rounded-none px-2 py-2 text-left"
                  onClick={() => setSelectedScope({ kind: "project", identity: project.identity })}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{project.label}</span>
                    <span className="block truncate text-ui-xs text-foreground-subtle">
                      {project.workspacePath}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          {knownProjects.length === 0 ? (
            <p className="pt-2 text-ui-sm text-foreground-subtle">
              {label("settings.credentials.projectsEmpty")}
            </p>
          ) : null}
        </nav>

        <div className="min-w-0 space-y-6">
          {isGlobalSelected ? (
            <section aria-labelledby="credential-global-heading" className="space-y-2">
              <h3
                id="credential-global-heading"
                className="text-ui-base font-medium text-foreground"
              >
                {label("settings.credentials.globalEntries")}
              </h3>
              {loading ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : visibleGlobalEntries.length === 0 ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.globalEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleGlobalEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  onEdit={openEdit}
                  onDelete={openDelete}
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
                className="text-ui-base font-medium text-foreground"
              >
                {intl.formatMessage(
                  { id: "settings.credentials.projectEntries" },
                  { project: selectedProject?.label ?? "" },
                )}
              </h3>
              {loading ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : !selectedProject || visibleProjectEntries.length === 0 ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.projectEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleProjectEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  onEdit={openEdit}
                  onDelete={openDelete}
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

          {selectedProject ? (
            <section aria-labelledby="credential-inherited-heading" className="space-y-2">
              <h3
                id="credential-inherited-heading"
                className="text-ui-base font-medium text-foreground"
              >
                {label("settings.credentials.inheritedGlobalEntries")}
              </h3>
              {loading ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.loading")}
                </p>
              ) : visibleGlobalEntries.length === 0 ? (
                <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.credentials.globalEmpty")}
                </p>
              ) : (
                <CredentialEntryList
                  entries={visibleGlobalEntries}
                  label={label}
                  kindLabel={kindLabel}
                  environmentLabel={(environment) => environmentLabel(environment, label)}
                  readOnlyLabel={label("settings.credentials.inheritedReadOnly")}
                  mutatingId={mutatingId}
                />
              )}
            </section>
          ) : null}

          <section aria-labelledby="credential-available-heading" className="space-y-2">
            <h3
              id="credential-available-heading"
              className="text-ui-base font-medium text-foreground"
            >
              {label("settings.credentials.availableEntries")}
            </h3>
            {loading ? (
              <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                {label("settings.credentials.loading")}
              </p>
            ) : visibleAvailableEntries.length === 0 ? (
              <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                {label("settings.credentials.availableEmpty")}
              </p>
            ) : (
              <CredentialEntryList
                entries={visibleAvailableEntries}
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
