import type { FormEvent, ReactNode } from "react";
import type { ProjectEnvironment } from "@zcode/shared";
import type { CredentialVaultEntry } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
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
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];
export type ProjectEnvironmentResourceDraft = ProjectEnvironment["resources"][number];
export interface ProjectEnvironmentEditorDraft {
  profile?: ProjectEnvironment;
  name: string;
  environment: Environment;
  instructions: string;
  resources: ProjectEnvironmentResourceDraft[];
}

function environmentLabel(environment: Environment, label: (id: string) => string) {
  return label(`settings.credentials.environment.${environment}`);
}

export function ProjectEnvironmentEditorDialog({
  draft,
  credentials,
  saving,
  onDraftChange,
  onClose,
  onSubmit,
  onToggleResource,
  onUpdateResource,
}: {
  draft: ProjectEnvironmentEditorDraft | null;
  credentials: CredentialVaultEntry[];
  saving: boolean;
  onDraftChange: (draft: ProjectEnvironmentEditorDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleResource: (credentialId: string, checked: boolean) => void;
  onUpdateResource: (
    credentialId: string,
    updates: Partial<ProjectEnvironmentResourceDraft>,
  ) => void;
}) {
  const { intl } = useZCodeIntl();
  const label = (id: string) => intl.formatMessage({ id });
  if (!draft) return null;
  const change = (updates: Partial<ProjectEnvironmentEditorDraft>) =>
    onDraftChange({ ...draft, ...updates });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>
              {label(
                draft.profile
                  ? "settings.projectEnvironments.editTitle"
                  : "settings.projectEnvironments.addTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {label("settings.projectEnvironments.formDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={label("settings.projectEnvironments.name")}>
                <Input
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </Field>
              <Field label={label("settings.credentials.environmentLabel")}>
                <Select
                  value={draft.environment}
                  onValueChange={(value) => change({ environment: value as Environment })}
                >
                  <SelectTrigger className="h-8 w-full rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENTS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {environmentLabel(value, label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={label("settings.projectEnvironments.instructions")}>
              <Textarea
                maxLength={12_000}
                rows={3}
                value={draft.instructions}
                onChange={(event) => change({ instructions: event.target.value })}
              />
            </Field>
            <div className="space-y-2">
              <div>
                <h4 className="text-ui-sm font-medium text-foreground">
                  {label("settings.projectEnvironments.resources")}
                </h4>
                <p className="text-ui-xs text-foreground-subtle">
                  {label("settings.projectEnvironments.resourcesDescription")}
                </p>
              </div>
              {credentials.length ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {credentials.map((credential) => {
                    const resource = draft.resources.find(
                      (item) => item.credentialId === credential.id,
                    );
                    return (
                      <li key={credential.id} className="p-3">
                        <label className="flex min-w-0 items-start gap-2 text-ui-sm">
                          <Checkbox
                            checked={Boolean(resource)}
                            disabled={!resource && draft.resources.length >= 32}
                            onCheckedChange={(checked) =>
                              onToggleResource(credential.id, checked === true)
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {credential.name}
                            </span>
                            <span className="block break-all text-ui-xs text-foreground-subtle">
                              {credential.host}
                              {credential.port === null ? "" : `:${credential.port}`}
                              {credential.username ? ` · ${credential.username}` : ""}
                            </span>
                          </span>
                        </label>
                        {resource ? (
                          <div className="mt-3 grid gap-2 pl-6 sm:grid-cols-2">
                            <Field label={label("settings.projectEnvironments.purpose")}>
                              <Input
                                required
                                maxLength={200}
                                value={resource.purpose}
                                onChange={(event) =>
                                  onUpdateResource(credential.id, { purpose: event.target.value })
                                }
                              />
                            </Field>
                            <Field
                              label={label("settings.projectEnvironments.resourceInstructions")}
                            >
                              <Input
                                maxLength={4000}
                                value={resource.instructions}
                                onChange={(event) =>
                                  onUpdateResource(credential.id, {
                                    instructions: event.target.value,
                                  })
                                }
                              />
                            </Field>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-md border border-border px-3 py-4 text-ui-sm text-foreground-subtle">
                  {label("settings.projectEnvironments.noCredentials")}
                </p>
              )}
              {draft.resources
                .filter(
                  (resource) => !credentials.some((entry) => entry.id === resource.credentialId),
                )
                .map((resource) => (
                  <div
                    key={resource.credentialId}
                    className="flex items-start gap-2 rounded-md border border-destructive/30 p-3"
                  >
                    <Checkbox
                      checked
                      onCheckedChange={(checked) =>
                        onToggleResource(resource.credentialId, checked === true)
                      }
                      aria-label={label("settings.projectEnvironments.removeUnavailable")}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-ui-sm text-destructive">
                        {label("settings.projectEnvironments.unavailableCredential")}
                      </p>
                      <p className="break-all text-ui-xs text-foreground-subtle">
                        {resource.credentialId} · {resource.purpose}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {label("settings.credentials.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {label(saving ? "settings.credentials.saving" : "settings.credentials.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-ui-sm font-medium text-foreground">
      {label}
      {children}
    </label>
  );
}
