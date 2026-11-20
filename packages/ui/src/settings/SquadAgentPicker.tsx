import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile, AgentSquadSave } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SquadAgentPicker({
  title,
  member,
  profiles,
  excludedIds,
  disabled,
  onChange,
  onRemove,
  onCreate,
}: {
  title: string;
  member: AgentSquadSave["leader"];
  profiles: AgentProfile[];
  excludedIds: string[];
  disabled: boolean;
  onChange(member: AgentSquadSave["leader"]): void;
  onRemove?: () => void;
  onCreate(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `squads.${key}` });
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-ui-base font-medium">{title}</h4>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeMember")}
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1 text-ui-caption">
          <span id={`${member.id}-agent`}>{t("selectAgent")}</span>
          <Select
            disabled={disabled}
            value={member.agentId}
            onValueChange={(agentId) => {
              const profile = profiles.find((profile) => profile.id === agentId);
              onChange({
                ...member,
                agentId,
                role: member.role || profile?.instructions.slice(0, 4000) || "",
              });
            }}
          >
            <SelectTrigger aria-labelledby={`${member.id}-agent`} className="w-full">
              <SelectValue placeholder={t("selectAgent")} />
            </SelectTrigger>
            <SelectContent>
              {member.agentId && !profiles.some((profile) => profile.id === member.agentId) ? (
                <SelectItem value={member.agentId} disabled>
                  {t("targetUnavailable")}
                </SelectItem>
              ) : null}
              {profiles
                .filter((profile) => !excludedIds.includes(profile.id))
                .map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" disabled={disabled} onClick={onCreate}>
          <Plus className="size-4" />
          {intl.formatMessage({ id: "agentProfiles.create" })}
        </Button>
      </div>
      <label className="block space-y-1 text-ui-caption">
        {t("teamRole")}
        <Textarea
          value={member.role}
          maxLength={4000}
          rows={2}
          required
          onChange={(event) => onChange({ ...member, role: event.target.value })}
        />
      </label>
    </fieldset>
  );
}
