import { useId } from "react";
import { Bot } from "lucide-react";
import { agentProfileSaveSchema, type AgentProfileSave, type DelegationAgent } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AgentProfileAcpConfig } from "./AgentProfileAcpConfig.js";
import { squadExecutionReference, squadRoleDraft, squadTargetLabel } from "./agentSquadDraft.js";

export function AgentProfileEditor({
  draft,
  targets,
  busy,
  workspacePath,
  onChange,
  onSave,
  onCancel,
}: {
  draft: AgentProfileSave;
  targets: DelegationAgent[];
  busy: boolean;
  workspacePath: string | null;
  onChange(draft: AgentProfileSave): void;
  onSave(): void;
  onCancel(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `agentProfiles.${key}` });
  const s = (key: string) => intl.formatMessage({ id: `squads.${key}` });
  const id = useId();
  const valid = agentProfileSaveSchema.safeParse(draft).success;
  const reference = squadExecutionReference(draft.execution);
  const selected = targets.find(
    (target) =>
      (target.kind === "api"
        ? squadExecutionReference(target.execution)
        : `acp.${target.agent}`) === reference,
  );
  return (
    <form
      data-testid="agent-profile-editor"
      className="mx-auto w-full min-w-0 max-w-[832px] space-y-7"
      aria-label={draft.expectedRevision ? t("edit") : t("create")}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSave();
      }}
    >
      <header className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
          <Bot aria-hidden="true" className="size-5 text-foreground-subtle" />
        </div>
        <div className="min-w-0">
          <h3 className="text-ui-lg font-semibold">
            {draft.expectedRevision ? t("edit") : t("create")}
          </h3>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{t("editorHint")}</p>
        </div>
      </header>
      <section aria-labelledby={`${id}-identity`} className="min-w-0 space-y-3">
        <h4 id={`${id}-identity`} className="text-ui-base font-medium">
          {t("identity")}
        </h4>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
            <label htmlFor={`${id}-name`} className="text-ui-base font-medium">
              {s("roleName")}
            </label>
            <Input
              id={`${id}-name`}
              value={draft.name}
              maxLength={80}
              required
              disabled={busy}
              placeholder={t("namePlaceholder")}
              className="min-w-0 text-mobile-input-safe md:text-ui-base"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <label htmlFor={`${id}-description`} className="text-ui-base font-medium">
              {t("description")}
            </label>
            <div className="min-w-0 space-y-1.5">
              <Textarea
                id={`${id}-description`}
                value={draft.description}
                maxLength={1000}
                rows={3}
                disabled={busy}
                placeholder={t("descriptionPlaceholder")}
                className="min-h-20 resize-y border-input-border bg-input text-foreground text-mobile-input-safe md:text-ui-base"
                onChange={(event) => onChange({ ...draft, description: event.target.value })}
              />
              <p aria-hidden="true" className="text-right text-ui-xs text-foreground-subtlest">
                {draft.description.length} / 1000
              </p>
            </div>
          </div>
        </div>
      </section>
      <section aria-labelledby={`${id}-behavior`} className="min-w-0 space-y-3">
        <h4 id={`${id}-behavior`} className="text-ui-base font-medium">
          {t("behavior")}
        </h4>
        <div className="min-w-0 space-y-3 rounded-xl border border-card-border bg-card p-4">
          <label htmlFor={`${id}-instructions`} className="block text-ui-base font-medium">
            {s("role")}
          </label>
          <Textarea
            id={`${id}-instructions`}
            value={draft.instructions}
            maxLength={12000}
            rows={7}
            required
            disabled={busy}
            placeholder={t("instructionsPlaceholder")}
            className="min-h-44 resize-y border-input-border bg-input text-foreground text-mobile-input-safe md:text-ui-base"
            onChange={(event) => onChange({ ...draft, instructions: event.target.value })}
          />
        </div>
      </section>
      <section aria-labelledby={`${id}-execution`} className="min-w-0 space-y-3">
        <div>
          <h4 id={`${id}-execution`} className="text-ui-base font-medium">
            {t("execution")}
          </h4>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{t("executionHint")}</p>
        </div>
        <div className="min-w-0 divide-y divide-border rounded-xl border border-card-border bg-card">
          <div className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
            <span id={`${id}-target`} className="text-ui-base font-medium">
              {s("executor")}
            </span>
            <Select
              disabled={busy}
              value={reference}
              onValueChange={(value) => {
                const target = targets.find(
                  (item) =>
                    (item.kind === "api"
                      ? squadExecutionReference(item.execution)
                      : `acp.${item.agent}`) === value,
                );
                if (target)
                  onChange({
                    ...draft,
                    execution: squadRoleDraft(target, draft.name, draft.instructions).execution,
                  });
              }}
            >
              <SelectTrigger aria-labelledby={`${id}-target`} className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!selected ? (
                  <SelectItem value={reference} disabled>
                    {s("targetUnavailable")}
                  </SelectItem>
                ) : null}
                {targets.map((target) => (
                  <SelectItem
                    key={
                      target.kind === "api"
                        ? squadExecutionReference(target.execution)
                        : `acp.${target.agent}`
                    }
                    value={
                      target.kind === "api"
                        ? squadExecutionReference(target.execution)
                        : `acp.${target.agent}`
                    }
                  >
                    {squadTargetLabel(target)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.execution.kind === "api" && selected?.kind === "api" ? (
            <div className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
              <span id={`${id}-reasoning`} className="text-ui-base font-medium">
                {s("reasoning")}
              </span>
              <Select
                disabled={busy}
                value={draft.execution.modelSelection.options?.reasoningLevel ?? ""}
                onValueChange={(reasoningLevel) => {
                  if (draft.execution.kind === "api")
                    onChange({
                      ...draft,
                      execution: {
                        ...draft.execution,
                        modelSelection: {
                          ...draft.execution.modelSelection,
                          options: { ...draft.execution.modelSelection.options, reasoningLevel },
                        },
                      },
                    });
                }}
              >
                <SelectTrigger aria-labelledby={`${id}-reasoning`} className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selected.reasoningLevels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {draft.execution.kind === "acp" ? (
            <div className="min-w-0 p-4">
              <AgentProfileAcpConfig
                execution={draft.execution}
                workspacePath={workspacePath}
                disabled={busy}
                onChange={(execution) => onChange({ ...draft, execution })}
              />
            </div>
          ) : null}
        </div>
      </section>
      {!targets.length ? (
        <p className="text-ui-caption text-foreground-subtle">{t("noTargets")}</p>
      ) : null}
      <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-background py-4">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
        <Button type="submit" disabled={busy || !valid || !targets.length}>
          {intl.formatMessage({ id: "common.save" })}
        </Button>
      </div>
    </form>
  );
}
