import type { WorkTaskWorkflowStage, WorkTaskScope } from "@zcode/shared";
import { Trash2 } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Button } from "@/components/ui/button.js";
import {
  Root as RadioGroup,
  Item as RadioGroupItem,
  Indicator as RadioIndicator,
} from "@radix-ui/react-radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useWorkTaskModels } from "@/hooks/useWorkTaskModels.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { canReorderWorkflowStep, workflowStepHandoff } from "@/lib/taskWorkflowDraft.js";
import {
  WorkTaskExecutorSelect,
  WorkTaskExecutionControls,
} from "@/work-tasks/WorkTaskExecutionControls.js";
import { useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { WorkflowStatusIcon } from "./WorkflowStepList.js";

export function WorkflowStepDetail({
  stage,
  stages,
  busy,
  scope,
  onChange,
  onRemove,
}: {
  stage: WorkTaskWorkflowStage;
  stages: WorkTaskWorkflowStage[];
  busy: boolean;
  scope: WorkTaskScope;
  onChange(patch: Partial<WorkTaskWorkflowStage>): void;
  onRemove(): void;
}) {
  const t = useWorkTaskMessages();
  const models = useWorkTaskModels(scope);
  const handoff = workflowStepHandoff(stage);
  const execution = stage.execution;
  const terminal = stage.status === "done" || stage.status === "canceled";
  const thought =
    execution?.kind === "api" && models.view
      ? resolveModelThoughtOption({
          modelSelectionView: models.view,
          providerId: execution.modelSelection.providerId,
          modelId: execution.modelSelection.modelId,
          currentValue: execution.modelSelection.options?.reasoningLevel,
        })
      : null;
  const options = [
    { id: "none", title: "noHandoff", description: "keepOwner" },
    { id: "agent", title: "agent", description: "agentHelp" },
    { id: "member", title: "member", description: "memberHelp" },
  ] as const;
  const index = stages.indexOf(stage);
  return (
    <section
      className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-card"
      data-testid="workflow-step-detail"
    >
      <header className="flex items-center gap-2 border-b border-border px-5 py-4 text-ui-base font-medium">
        <WorkflowStatusIcon stage={stage} />
        <span className="min-w-0 truncate">{stage.name || t("workflow.unnamed")}</span>
        <span className="font-mono text-ui-sm font-normal text-foreground-subtle">
          {stage.status ?? "custom"}
        </span>
        {canReorderWorkflowStep(stage) ? (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-6"
            disabled={busy || stages.length <= 2}
            aria-label={t("workflow.removeStage")}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </header>
      <div className="space-y-6 p-5">
        <label className="block space-y-2 text-ui-base">
          <span>{t("workflow.status")}</span>
          <Input
            aria-label={t("workflow.stageName")}
            value={stage.name}
            maxLength={80}
            disabled={busy || stage.enabled === false}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          <span className="block text-ui-sm leading-5 text-foreground-subtle">
            {t("workflow.statusHelp")}
          </span>
        </label>
        {stage.enabled === false ? (
          <p className="text-ui-sm text-foreground-subtle">{t("workflow.excludedHelp")}</p>
        ) : terminal ? (
          <p className="text-ui-sm leading-5 text-foreground-subtle">
            {t("workflow.terminalHelp")}
          </p>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-ui-base">{t("workflow.onEnter")}</legend>
              <RadioGroup
                className="grid gap-2"
                value={handoff}
                disabled={busy}
                onValueChange={(value) => {
                  if (value === "none" || value === "member")
                    onChange({
                      handoff: value,
                      execution: undefined,
                      owner: value === "member" ? stage.owner : undefined,
                    });
                  else {
                    const agent = models.agents.find((item) => item.enabled && item.ready);
                    onChange({
                      handoff: "agent",
                      owner: undefined,
                      execution:
                        execution ??
                        (models.view?.preferredSelection
                          ? {
                              kind: "api",
                              mode: "build",
                              modelSelection: models.view.preferredSelection,
                            }
                          : agent
                            ? { kind: "acp", agent: agent.agent, config: [] }
                            : undefined),
                    });
                  }
                }}
                aria-label={t("workflow.onEnter")}
              >
                {options.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3",
                      handoff === option.id && "border-brand bg-accent",
                    )}
                  >
                    <RadioGroupItem
                      value={option.id}
                      aria-label={t(`workflow.${option.title}`)}
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input-border text-brand outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-brand"
                    >
                      <RadioIndicator className="size-2 rounded-full bg-brand" />
                    </RadioGroupItem>
                    <span>
                      <span className="block text-ui-base font-medium">
                        {t(`workflow.${option.title}`)}
                      </span>
                      <span className="block text-ui-sm text-foreground-subtle">
                        {t(`workflow.${option.description}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {handoff === "member" ? (
              <label className="block space-y-2 text-ui-base">
                <span>{t("workflow.owner")}</span>
                <Input
                  aria-label={t("workflow.owner")}
                  value={stage.owner ?? ""}
                  maxLength={120}
                  disabled={busy}
                  onChange={(event) => onChange({ owner: event.target.value || undefined })}
                />
                <span className="block text-ui-sm text-foreground-subtle">
                  {t("workflow.memberDirectoryHelp")}
                </span>
              </label>
            ) : null}
            {handoff === "agent" ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  {execution ? (
                    <>
                      <WorkTaskExecutorSelect
                        task={null}
                        models={models}
                        execution={execution}
                        busy={busy}
                        selectExecutor={(execution) => onChange({ execution })}
                      />
                      <WorkTaskExecutionControls
                        models={models}
                        execution={execution}
                        busy={busy}
                        thought={thought}
                        changeExecution={(execution) => onChange({ execution })}
                      />
                    </>
                  ) : (
                    <p role="alert" className="text-ui-sm text-destructive">
                      {t("workflow.noAgent")}
                    </p>
                  )}
                </div>
                <label className="block space-y-2 text-ui-base">
                  <span>{t("workflow.instructions")}</span>
                  <Textarea
                    aria-label={t("workflow.instructions")}
                    value={stage.instructions}
                    maxLength={20_000}
                    rows={4}
                    disabled={busy}
                    onChange={(event) => onChange({ instructions: event.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TargetSelect
                    label={t("workflow.next")}
                    value={stage.nextStageId}
                    disabled={busy}
                    none={t(stage.status ? "workflow.noNext" : "workflow.final")}
                    stages={stages
                      .slice(index + 1)
                      .filter((item) => item.enabled !== false && item.status !== "canceled")}
                    onChange={(nextStageId) => onChange({ nextStageId })}
                  />
                  <TargetSelect
                    label={t("workflow.returnTarget")}
                    value={stage.returnStageId}
                    disabled={busy}
                    none={t("workflow.noReturn")}
                    stages={stages.slice(0, index).filter((item) => item.enabled !== false)}
                    onChange={(returnStageId) => onChange({ returnStageId })}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
function TargetSelect({
  label,
  value,
  none,
  stages,
  disabled,
  onChange,
}: {
  label: string;
  value?: string;
  none: string;
  stages: WorkTaskWorkflowStage[];
  disabled: boolean;
  onChange(value: string | undefined): void;
}) {
  return (
    <label className="block min-w-0 space-y-2 text-ui-sm">
      <span>{label}</span>
      <Select
        value={value ?? "none"}
        disabled={disabled}
        onValueChange={(value) => onChange(value === "none" ? undefined : value)}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{none}</SelectItem>
          {stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              {stage.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
