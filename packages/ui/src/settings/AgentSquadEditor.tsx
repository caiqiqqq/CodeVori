import { Plus } from "lucide-react";
import { agentSquadSaveSchema, type AgentSquadSave, type AgentProfile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SquadAgentPicker } from "./SquadAgentPicker.js";

export function AgentSquadEditor({
  draft,
  profiles,
  onCreateProfile,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: AgentSquadSave;
  profiles: AgentProfile[];
  onCreateProfile(memberId: string): void;
  busy: boolean;
  onChange(draft: AgentSquadSave): void;
  onSave(): void;
  onCancel(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `squads.${key}` });
  const valid = agentSquadSaveSchema.safeParse(draft).success;
  return (
    <form
      data-testid="squad-editor"
      className="min-w-0 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSave();
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <label className="block space-y-1 text-ui-caption">
          {t("name")}
          <Input
            autoFocus
            value={draft.name}
            maxLength={80}
            required
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="block space-y-1 text-ui-caption">
          {t("description")}
          <Input
            value={draft.description}
            maxLength={1000}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="block space-y-1 text-ui-caption">
          {t("instructions")}
          <Textarea
            value={draft.instructions}
            maxLength={12000}
            rows={3}
            onChange={(event) => onChange({ ...draft, instructions: event.target.value })}
          />
        </label>
      </fieldset>
      <p className="text-ui-caption text-foreground-subtle">{t("leaderHint")}</p>
      <SquadAgentPicker
        title={t("leader")}
        member={draft.leader}
        profiles={profiles}
        excludedIds={draft.members.map((member) => member.agentId)}
        onCreate={() => onCreateProfile(draft.leader.id)}
        disabled={busy}
        onChange={(leader) => onChange({ ...draft, leader })}
      />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ui-base font-medium">{t("members")}</h3>
        <Button
          type="button"
          variant="outline"
          disabled={busy || draft.members.length >= 8}
          onClick={() =>
            onChange({
              ...draft,
              members: [...draft.members, { id: crypto.randomUUID(), agentId: "", role: "" }],
            })
          }
        >
          <Plus className="size-4" />
          {t("addMember")}
        </Button>
      </div>
      {draft.members.map((member, index) => (
        <SquadAgentPicker
          key={member.id}
          title={`${t("member")} ${index + 1}`}
          member={member}
          profiles={profiles}
          excludedIds={[draft.leader, ...draft.members.filter((item) => item.id !== member.id)].map(
            (item) => item.agentId,
          )}
          onCreate={() => onCreateProfile(member.id)}
          disabled={busy}
          onChange={(next) =>
            onChange({
              ...draft,
              members: draft.members.map((item) => (item.id === next.id ? next : item)),
            })
          }
          onRemove={
            draft.members.length > 1
              ? () =>
                  onChange({
                    ...draft,
                    members: draft.members.filter((item) => item.id !== member.id),
                  })
              : undefined
          }
        />
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
        <Button type="submit" disabled={busy || !valid}>
          {intl.formatMessage({ id: "common.save" })}
        </Button>
      </div>
    </form>
  );
}
