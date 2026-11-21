import { agentProfileSaveSchema, type AgentProfileSave, type DelegationAgent } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AgentSquadMemberEditor } from "./AgentSquadMemberEditor.js";
import { AgentProfileAcpConfig } from "./AgentProfileAcpConfig.js";

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
  const valid = agentProfileSaveSchema.safeParse(draft).success;
  return (
    <form
      data-testid="agent-profile-editor"
      className="min-w-0 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSave();
      }}
    >
      <AgentSquadMemberEditor
        title={t("configuration")}
        member={{
          id: draft.id,
          name: draft.name,
          role: draft.instructions,
          execution: draft.execution,
        }}
        targets={targets}
        disabled={busy}
        onChange={(member) =>
          onChange({
            ...draft,
            name: member.name,
            instructions: member.role,
            execution: member.execution,
          })
        }
      />
      {draft.execution.kind === "acp" ? (
        <AgentProfileAcpConfig
          execution={draft.execution}
          workspacePath={workspacePath}
          disabled={busy}
          onChange={(execution) => onChange({ ...draft, execution })}
        />
      ) : null}
      <label className="block space-y-1 text-ui-caption">
        {t("description")}
        <Input
          value={draft.description}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </label>
      {!targets.length ? (
        <p className="text-ui-caption text-foreground-subtle">{t("noTargets")}</p>
      ) : null}
      <div className="flex justify-end gap-2">
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
