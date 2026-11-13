import { useCallback, useEffect, useState } from "react";
import { Database, KeyRound, Pencil, Plus, Server, Trash2 } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";
import { ProjectEnvironmentSection } from "./ProjectEnvironmentSection.js";
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
  workspaceIdentity?: string;
}) {
  const { intl } = useZCodeIntl();
  const { list } = useCredentialVault();
  const [entries, setEntries] = useState<CredentialVaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<CredentialVaultDialogMode | null>(null);

  const label = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorId(null);
    try {
      setEntries(await list());
    } catch {
      setErrorId("settings.credentials.error.load");
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => setDialogMode({ kind: "create" });
  const openEdit = (entry: CredentialVaultEntry) => setDialogMode({ kind: "edit", entry });
  const openDelete = (entry: CredentialVaultEntry) => setDialogMode({ kind: "delete", entry });
  const kindLabel = (kind: CredentialVaultKind) =>
    kind === "server" || kind === "database" ? label(`settings.credentials.kind.${kind}`) : kind;

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

      {loading ? (
        <p className="py-6 text-ui-base text-foreground-subtle">
          {label("settings.credentials.loading")}
        </p>
      ) : entries.length === 0 ? (
        <div className="border-y border-border py-8 text-center">
          <KeyRound className="mx-auto mb-2 size-5 text-foreground-subtle" aria-hidden="true" />
          <p className="text-ui-base text-foreground-subtle">
            {label("settings.credentials.empty")}
          </p>
        </div>
      ) : (
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
                    {environmentLabel(entry.environment, label)}
                  </span>
                  <span className="text-ui-xs text-foreground-subtle">
                    {entry.hasSecret ? label("settings.credentials.saved") : ""}
                  </span>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-ui-sm text-foreground-subtle">
                  {entry.kind === "database" ? (
                    <Database className="size-3.5" aria-hidden="true" />
                  ) : entry.kind === "server" ? (
                    <Server className="size-3.5" aria-hidden="true" />
                  ) : (
                    <KeyRound className="size-3.5" aria-hidden="true" />
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
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={label("settings.credentials.edit")}
                  title={label("settings.credentials.edit")}
                  onClick={() => openEdit(entry)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={label("settings.credentials.delete")}
                  title={label("settings.credentials.delete")}
                  onClick={() => openDelete(entry)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CredentialVaultEntryDialog
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onChanged={refresh}
      />
      <ProjectEnvironmentSection
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        credentials={entries}
      />
    </section>
  );
}
