import { Database, Link2, Pencil, Server, Trash2, Unlink } from "lucide-react";
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
              {readOnlyLabel ? (
                <span className="text-ui-xs text-foreground-subtle">{readOnlyLabel}</span>
              ) : null}
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
