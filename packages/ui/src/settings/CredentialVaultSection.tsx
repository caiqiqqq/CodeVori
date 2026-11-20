import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Link2, Pencil, Plus, Server, Trash2, Unlink } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import {
  CredentialVaultEntryDialog,
  type CredentialVaultDialogMode,
} from "./CredentialVaultEntryDialog.js";

function environmentLabel(environment: CredentialVaultEnvironment, label: (id: string) => string) {
  return label(`settings.credentials.environment.${environment}`);
}

export function CredentialVaultSection({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string | null;
  workspaceIdentity?: string | null;
}) {
  const { intl } = useZCodeIntl();
  const { list, listUnassigned, attach, detach } = useCredentialVault();
  const projectIdentity = workspaceIdentity?.trim() || workspacePath?.trim() || "";
  const [projectEntries, setProjectEntries] = useState<CredentialVaultEntry[]>([]);
  const [availableEntries, setAvailableEntries] = useState<CredentialVaultEntry[]>([]);
  const [entriesScope, setEntriesScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [mutationErrorId, setMutationErrorId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<CredentialVaultDialogMode | null>(null);
  const refreshVersion = useRef(0);
  const activeProjectIdentity = useRef(projectIdentity);
  activeProjectIdentity.current = projectIdentity;

  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    setErrorId(null);
    try {
      const [attached, available] = await Promise.all([
        projectIdentity ? list(projectIdentity) : Promise.resolve([]),
        listUnassigned(),
      ]);
      // 项目切换后，旧读取结果不能覆盖当前凭据列表。
      if (refreshVersion.current === version) {
        setProjectEntries(attached);
        setAvailableEntries(available);
        setEntriesScope(projectIdentity);
      }
    } catch {
      if (refreshVersion.current === version) setErrorId("settings.credentials.error.load");
    } finally {
      if (refreshVersion.current === version) setLoading(false);
    }
  }, [list, listUnassigned, projectIdentity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // 项目切换后关闭旧项目的编辑上下文，避免继续操作上一项目的凭证。
    setDialogMode(null);
  }, [projectIdentity]);

  const openCreate = () => setDialogMode({ kind: "create" });
  const openEdit = (entry: CredentialVaultEntry) => setDialogMode({ kind: "edit", entry });
  const openDelete = (entry: CredentialVaultEntry) => setDialogMode({ kind: "delete", entry });
  const kindLabel = (kind: CredentialVaultKind) => label(`settings.credentials.kind.${kind}`);
  const visibleProjectEntries = entriesScope === projectIdentity ? projectEntries : [];
  const visibleAvailableEntries = entriesScope === projectIdentity ? availableEntries : [];
  const runAttachment = async (
    entry: CredentialVaultEntry,
    operation: () => Promise<void>,
    failureId: string,
  ) => {
    const operationIdentity = projectIdentity;
    setMutatingId(entry.id);
    setMutationErrorId(null);
    try {
      await operation();
      if (activeProjectIdentity.current === operationIdentity) await refresh();
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

      {loading ? (
        <p className="py-6 text-ui-base text-foreground-subtle">
          {label("settings.credentials.loading")}
        </p>
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="credential-project-heading" className="space-y-2">
            <h3
              id="credential-project-heading"
              className="text-ui-base font-medium text-foreground"
            >
              {label("settings.credentials.projectEntries")}
            </h3>
            {!projectIdentity ? (
              <p className="border-y border-border py-4 text-ui-sm text-foreground-subtle">
                {label("settings.credentials.noProject")}
              </p>
            ) : visibleProjectEntries.length === 0 ? (
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
                mutatingId={mutatingId}
              />
            )}
          </section>

          <section aria-labelledby="credential-available-heading" className="space-y-2">
            <h3
              id="credential-available-heading"
              className="text-ui-base font-medium text-foreground"
            >
              {label("settings.credentials.availableEntries")}
            </h3>
            {visibleAvailableEntries.length === 0 ? (
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
                onAttach={
                  projectIdentity
                    ? (entry) =>
                        void runAttachment(
                          entry,
                          () => attach(entry.id, projectIdentity),
                          "settings.credentials.error.attach",
                        )
                    : undefined
                }
                mutatingId={mutatingId}
              />
            )}
          </section>
        </div>
      )}

      <CredentialVaultEntryDialog
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onChanged={refresh}
      />
    </section>
  );
}

function CredentialEntryList({
  entries,
  label,
  kindLabel,
  environmentLabel,
  onEdit,
  onDelete,
  onAttach,
  onDetach,
  mutatingId,
}: {
  entries: CredentialVaultEntry[];
  label: (id: string) => string;
  kindLabel: (kind: CredentialVaultKind) => string;
  environmentLabel: (environment: CredentialVaultEnvironment) => string;
  onEdit: (entry: CredentialVaultEntry) => void;
  onDelete: (entry: CredentialVaultEntry) => void;
  onAttach?: (entry: CredentialVaultEntry) => void;
  onDetach?: (entry: CredentialVaultEntry) => void;
  mutatingId: string | null;
}) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-ui-base font-medium text-foreground">
                {entry.name}
              </span>
              <span className="text-ui-xs text-foreground-subtle">
                {environmentLabel(entry.environment)}
              </span>
              <span className="text-ui-xs text-foreground-subtle">
                {entry.hasSecret ? label("settings.credentials.saved") : ""}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-ui-sm text-foreground-subtle">
              {entry.kind === "database" ? (
                <Database className="size-3.5" aria-hidden="true" />
              ) : (
                <Server className="size-3.5" aria-hidden="true" />
              )}
              <span>{kindLabel(entry.kind)}</span>
              <span aria-hidden="true">·</span>
              <span className="break-all">
                {entry.host}
                {entry.port === null ? "" : `:${entry.port}`}
              </span>
              {entry.username ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="break-all">{entry.username}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onAttach ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={label("settings.credentials.attach")}
                title={label("settings.credentials.attach")}
                disabled={mutatingId === entry.id}
                onClick={() => onAttach(entry)}
              >
                <Link2 aria-hidden="true" />
              </Button>
            ) : null}
            {onDetach ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={label("settings.credentials.detach")}
                title={label("settings.credentials.detach")}
                disabled={mutatingId === entry.id}
                onClick={() => onDetach(entry)}
              >
                <Unlink aria-hidden="true" />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label("settings.credentials.edit")}
              title={label("settings.credentials.edit")}
              onClick={() => onEdit(entry)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label("settings.credentials.delete")}
              title={label("settings.credentials.delete")}
              onClick={() => onDelete(entry)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
