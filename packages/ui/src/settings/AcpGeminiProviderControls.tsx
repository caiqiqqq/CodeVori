import { useEffect, useRef, useState } from "react";
import { acpGeminiProviderSchema, createUuid, type AcpGeminiProvider } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useAcpGeminiProviders } from "@/hooks/useAcpGeminiProviders.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AcpGeminiProviderControls({
  providers,
  selectedId,
  onSelect,
}: {
  providers: ReturnType<typeof useAcpGeminiProviders>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const confirm = useConfirmDialog();
  const label = (key: string) =>
    intl.formatMessage({ id: `settings.acpAgents.env.provider.${key}` });
  const [draft, setDraft] = useState<AcpGeminiProvider | null>(null);
  const [invalid, setInvalid] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected = providers.view?.providers.find((provider) => provider.id === selectedId);
  const disabled = providers.loading || providers.saving;
  return (
    <div className="space-y-2" data-testid="acp-gemini-providers">
      <label htmlFor="acp-gemini-provider" className="text-ui-sm text-foreground-subtle">
        {label("select")}
      </label>
      {providers.loading ? (
        <p className="text-ui-sm text-foreground-subtle">{label("loading")}</p>
      ) : providers.view?.providers.length ? (
        <Select value={selected?.id ?? ""} onValueChange={onSelect} disabled={disabled}>
          <SelectTrigger id="acp-gemini-provider" className="w-full">
            <SelectValue placeholder={label("select")} />
          </SelectTrigger>
          <SelectContent>
            {providers.view.providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-ui-sm text-foreground-subtle" data-testid="acp-gemini-providers-empty">
          {label("empty")}
        </p>
      )}
      {selectedId && !selected && !providers.loading ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {label("missing")}
        </p>
      ) : null}
      {providers.error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {label(providers.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !providers.view}
          onClick={() => {
            setInvalid(false);
            setDraft({ id: createUuid(), name: "", apiUrl: "", apiKey: "", model: "" });
          }}
          data-testid="acp-gemini-provider-add"
        >
          {label("add")}
        </Button>
        {selected ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setInvalid(false);
                setDraft({ ...selected });
              }}
            >
              {label("edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                const expectedVersion = providers.view!.version;
                void confirm({
                  title: label("delete"),
                  description: label("deleteConfirm"),
                  confirmLabel: label("delete"),
                }).then(async (accepted) => {
                  if (accepted && mounted.current)
                    await providers.update({ action: "delete", id: selected.id, expectedVersion });
                });
              }}
            >
              {label("delete")}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => void providers.reload()}
        >
          {label("refresh")}
        </Button>
      </div>
      <p className="text-ui-xs text-foreground-subtle">{label("hint")}</p>
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !providers.saving) setDraft(null);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
          showCloseButton={!providers.saving}
          data-testid="acp-gemini-provider-dialog"
        >
          <DialogHeader>
            <DialogTitle>{label("configure")}</DialogTitle>
            <DialogDescription>{label("hint")}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form
              id="acp-gemini-provider-form"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = acpGeminiProviderSchema.safeParse(draft);
                if (!parsed.success || !providers.view) {
                  setInvalid(true);
                  return;
                }
                void providers
                  .update({
                    action: "upsert",
                    expectedVersion: providers.view.version,
                    provider: parsed.data,
                  })
                  .then((saved) => {
                    if (saved && mounted.current) {
                      if (!selectedId) onSelect(parsed.data.id);
                      setDraft(null);
                    }
                  });
              }}
            >
              {(["name", "apiUrl", "apiKey", "model"] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <label
                    htmlFor={`acp-gemini-provider-${key}`}
                    className="text-ui-sm text-foreground-subtle"
                  >
                    {label(key)}
                  </label>
                  <Input
                    id={`acp-gemini-provider-${key}`}
                    value={draft[key]}
                    type={key === "apiKey" ? "password" : "text"}
                    disabled={providers.saving}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setInvalid(false);
                      setDraft({ ...draft, [key]: event.target.value });
                    }}
                  />
                </div>
              ))}
              {invalid ? (
                <p role="alert" className="text-ui-sm text-destructive">
                  {label("invalid")}
                </p>
              ) : null}
              {providers.error ? (
                <p role="alert" className="text-ui-sm text-destructive">
                  {label(providers.error)}
                </p>
              ) : null}
            </form>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={providers.saving}
              onClick={() => setDraft(null)}
            >
              {label("cancel")}
            </Button>
            <Button
              type="submit"
              form="acp-gemini-provider-form"
              disabled={providers.saving || !providers.view}
            >
              {label("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
