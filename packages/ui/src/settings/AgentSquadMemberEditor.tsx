import { Trash2 } from "lucide-react";
import type { AgentSquadMember, DelegationAgent } from "@zcode/shared";
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
import { squadExecutionReference, squadRoleDraft, squadTargetLabel } from "./agentSquadDraft.js";

export function AgentSquadMemberEditor({
  member,
  targets,
  onChange,
  onRemove,
  disabled,
  title,
}: {
  member: AgentSquadMember;
  targets: DelegationAgent[];
  onChange(member: AgentSquadMember): void;
  onRemove?: () => void;
  disabled: boolean;
  title: string;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `squads.${key}` });
  const reference = squadExecutionReference(member.execution);
  const selected = targets.find(
    (target) =>
      squadExecutionReference(
        target.kind === "api" ? target.execution : { kind: "acp", agent: target.agent, config: [] },
      ) === reference,
  );
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-3 rounded-xl border border-card-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-ui-base font-medium">{title}</h4>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeMember")}
            onClick={onRemove}
            disabled={disabled}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-ui-caption">
          {t("roleName")}
          <Input
            value={member.name}
            maxLength={80}
            onChange={(event) => onChange({ ...member, name: event.target.value })}
            required
          />
        </label>
        <div className="min-w-0 space-y-1 text-ui-caption">
          <span id={`${member.id}-executor`}>{t("executor")}</span>
          <Select
            disabled={disabled}
            value={reference}
            onValueChange={(value) => {
              const target = targets.find(
                (item) =>
                  squadExecutionReference(
                    item.kind === "api"
                      ? item.execution
                      : { kind: "acp", agent: item.agent, config: [] },
                  ) === value,
              );
              if (target)
                onChange({
                  ...member,
                  execution: squadRoleDraft(target, member.name, member.role).execution,
                });
            }}
          >
            <SelectTrigger aria-labelledby={`${member.id}-executor`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!selected ? (
                <SelectItem value={reference} disabled>
                  {t("targetUnavailable")}
                </SelectItem>
              ) : null}
              {targets.map((target) => {
                const value =
                  target.kind === "api"
                    ? squadExecutionReference(target.execution)
                    : `acp.${target.agent}`;
                return (
                  <SelectItem key={value} value={value}>
                    {squadTargetLabel(target)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      {member.execution.kind === "api" && selected?.kind === "api" ? (
        <div className="space-y-1 text-ui-caption">
          <span id={`${member.id}-reasoning`}>{t("reasoning")}</span>
          <Select
            disabled={disabled}
            value={member.execution.modelSelection.options?.reasoningLevel ?? ""}
            onValueChange={(reasoningLevel) => {
              if (member.execution.kind === "api")
                onChange({
                  ...member,
                  execution: {
                    ...member.execution,
                    modelSelection: {
                      ...member.execution.modelSelection,
                      options: { ...member.execution.modelSelection.options, reasoningLevel },
                    },
                  },
                });
            }}
          >
            <SelectTrigger aria-labelledby={`${member.id}-reasoning`} className="w-full">
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
      <label className="block space-y-1 text-ui-caption">
        {t("role")}
        <Textarea
          aria-label={t("role")}
          value={member.role}
          maxLength={4000}
          rows={2}
          onChange={(event) => onChange({ ...member, role: event.target.value })}
          required
        />
      </label>
    </fieldset>
  );
}
