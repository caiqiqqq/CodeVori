import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type {
  CredentialVaultEntry,
  CredentialVaultEnvironment,
  CredentialVaultKind,
  SaveCredentialVaultEntryInput,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCredentialVault } from "@/hooks/useCredentialVault.js";

export type CredentialVaultDialogMode =
  | { kind: "create" }
  | { kind: "edit" | "delete"; entry: CredentialVaultEntry };

interface CredentialDraft {
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: string;
  username: string;
  workspaceIdentity: string;
  secret: string;
}

const EMPTY_DRAFT: CredentialDraft = {
  name: "",
  kind: "server",
  environment: "test",
  host: "",
  port: "",
  username: "",
  workspaceIdentity: "",
  secret: "",
};

const ENVIRONMENTS: CredentialVaultEnvironment[] = ["development", "test", "staging", "production"];

function toDraft(entry?: CredentialVaultEntry): CredentialDraft {
  if (!entry) return EMPTY_DRAFT;
  return {
    name: entry.name,
    kind: entry.kind,
    environment: entry.environment,
    host: entry.host,
    port: entry.port === null ? "" : String(entry.port),
    username: entry.username ?? "",
    workspaceIdentity: entry.workspaceIdentity ?? "",
    secret: "",
  };
}

export function CredentialVaultEntryDialog({
  mode,
  onClose,
  onChanged,
}: {
  mode: CredentialVaultDialogMode | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const { save, remove } = useCredentialVault();
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const label = (id: string) => intl.formatMessage({ id });

  useEffect(() => {
    setDraft(mode?.kind === "edit" ? toDraft(mode.entry) : EMPTY_DRAFT);
    setErrorId(null);
  }, [mode]);

  const environmentLabel = (environment: CredentialVaultEnvironment) =>
    label(`settings.credentials.environment.${environment}`);
  const kindLabel = (kind: CredentialVaultKind) => label(`settings.credentials.kind.${kind}`);
  const isDelete = mode?.kind === "delete";
  const editing = mode?.kind === "edit" ? mode.entry : null;

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode?.kind !== "create" && mode?.kind !== "edit") return;
    setSaving(true);
    setErrorId(null);
    const input: SaveCredentialVaultEntryInput = {
      ...(mode.kind === "edit" ? { id: mode.entry.id } : {}),
      name: draft.name,
      kind: draft.kind,
      environment: draft.environment,
      host: draft.host,
      port: draft.port ? Number(draft.port) : null,
      username: draft.username || null,
      workspaceIdentity: draft.workspaceIdentity || null,
      ...(draft.secret ? { secret: draft.secret } : {}),
    };
    try {
      await save(input);
      setDraft(EMPTY_DRAFT);
      onClose();
      await onChanged();
    } catch {
      setErrorId("settings.credentials.error.save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (mode?.kind !== "delete") return;
    setRemoving(true);
    setErrorId(null);
    try {
      await remove(mode.entry.id);
      onClose();
      await onChanged();
    } catch {
      setErrorId("settings.credentials.error.delete");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {isDelete && mode?.kind === "delete" ? (
          <>
            <DialogHeader>
              <DialogTitle>{label("settings.credentials.confirmDeleteTitle")}</DialogTitle>
              <DialogDescription>
                {label("settings.credentials.confirmDeleteDescription")}
              </DialogDescription>
            </DialogHeader>
            <p className="break-words text-ui-base font-medium text-foreground">
              {mode.entry.name}
            </p>
            {errorId ? <ErrorMessage label={label} errorId={errorId} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={removing}>
                {label("settings.credentials.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={removing}
              >
                <Trash2 aria-hidden="true" />
                {label(removing ? "settings.credentials.deleting" : "settings.credentials.delete")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {label(
                  editing ? "settings.credentials.editTitle" : "settings.credentials.addTitle",
                )}
              </DialogTitle>
              <DialogDescription>{label("settings.credentials.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={label("settings.credentials.name")}>
                <Input
                  autoFocus
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label={label("settings.credentials.kindLabel")}>
                <Select
                  value={draft.kind}
                  onValueChange={(kind) =>
                    setDraft({ ...draft, kind: kind as CredentialVaultKind })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="server">{kindLabel("server")}</SelectItem>
                    <SelectItem value="database">{kindLabel("database")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={label("settings.credentials.environmentLabel")}>
                <Select
                  value={draft.environment}
                  onValueChange={(environment) =>
                    setDraft({
                      ...draft,
                      environment: environment as CredentialVaultEnvironment,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENTS.map((environment) => (
                      <SelectItem key={environment} value={environment}>
                        {environmentLabel(environment)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={label("settings.credentials.host")}>
                <Input
                  required
                  maxLength={255}
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={draft.host}
                  onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                />
              </Field>
              <Field label={label("settings.credentials.port")}>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                />
              </Field>
              <Field label={label("settings.credentials.username")}>
                <Input
                  maxLength={255}
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </Field>
              <Field label={label("settings.credentials.workspaceIdentity")}>
                <Input
                  maxLength={2048}
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={draft.workspaceIdentity}
                  onChange={(event) =>
                    setDraft({ ...draft, workspaceIdentity: event.target.value })
                  }
                />
              </Field>
              <Field label={label("settings.credentials.secret")}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required={!editing}
                  maxLength={16_384}
                  value={draft.secret}
                  placeholder={
                    editing ? label("settings.credentials.secretPlaceholder") : undefined
                  }
                  onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
                />
              </Field>
            </div>
            {errorId ? <ErrorMessage label={label} errorId={errorId} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                {label("settings.credentials.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {label(saving ? "settings.credentials.saving" : "settings.credentials.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-ui-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ErrorMessage({ label, errorId }: { label: (id: string) => string; errorId: string }) {
  return (
    <p role="alert" className="text-ui-sm text-destructive">
      {label(errorId)}
    </p>
  );
}
