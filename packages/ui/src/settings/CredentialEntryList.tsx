import { Database, Link2, LockKeyhole, Pencil, Server, Trash2, Unlink } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";

export function CredentialEntryList({
  entries,
  label,
  kindLabel,
  environmentLabel,
  onEdit,
  onDelete,
  attachLabel,
  detachLabel,
  readOnlyLabel,
  onAttach,
  onDetach,
  mutatingId,
}: {
  entries: CredentialVaultEntry[];
  label: (id: string) => string;
  kindLabel: (kind: CredentialVaultKind) => string;
  environmentLabel: (environment: CredentialVaultEnvironment) => string;
  onEdit?: (entry: CredentialVaultEntry) => void;
  onDelete?: (entry: CredentialVaultEntry) => void;
  attachLabel?: string;
  detachLabel?: string;
  readOnlyLabel?: string;
  onAttach?: (entry: CredentialVaultEntry) => void;
  onDetach?: (entry: CredentialVaultEntry) => void;
  mutatingId: string | null;
}) {
  return (
    <ul className="overflow-hidden rounded-xl bg-surface">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex min-w-0 flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground-subtle">
              {entry.kind === "database" ? (
                <Database className="size-4" aria-hidden="true" />
              ) : (
                <Server className="size-4" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-all text-ui-base font-medium text-foreground">
                  {entry.name}
                </span>
                <span className="rounded-md border border-border px-1.5 text-ui-xs text-foreground-subtle">
                  {environmentLabel(entry.environment)}
                </span>
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle">
                <span>{kindLabel(entry.kind)}</span>
                <span aria-hidden="true">·</span>
                <span className="break-all font-mono">
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
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-foreground-subtlest">
                {entry.hasSecret ? (
                  <span className="inline-flex items-center gap-1">
                    <LockKeyhole className="size-3" aria-hidden="true" />
                    {label("settings.credentials.saved")}
                  </span>
                ) : null}
                {readOnlyLabel ? <span>{readOnlyLabel}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1 text-foreground-subtle">
            {onAttach ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={attachLabel ?? label("settings.credentials.attach")}
                title={attachLabel ?? label("settings.credentials.attach")}
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
                aria-label={detachLabel ?? label("settings.credentials.detach")}
                title={detachLabel ?? label("settings.credentials.detach")}
                disabled={mutatingId === entry.id}
                onClick={() => onDetach(entry)}
              >
                <Unlink aria-hidden="true" />
              </Button>
            ) : null}
            {onEdit ? (
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
            ) : null}
            {onDelete ? (
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
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
