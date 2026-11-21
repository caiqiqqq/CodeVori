import type { WorkTaskWorkflow } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { WorkflowStatusIcon } from "./WorkflowStepList.js";

export function BuiltinTaskWorkflowDetails({
  workflow,
  onBack,
}: {
  workflow: WorkTaskWorkflow;
  onBack(): void;
}) {
  const t = useWorkTaskMessages();
  return (
    <section className="min-w-0 space-y-5" data-testid="builtin-task-workflow">
      <SettingsBreadcrumbReporter items={[{ label: workflow.name }]} onSectionSelect={onBack} />
      <Button variant="ghost" onClick={onBack}>
        {t("workflow.libraryTitle")}
      </Button>
      <h2 className="text-ui-lg font-medium">{workflow.name}</h2>
      <p className="text-ui-sm text-foreground-subtle">{t("workflow.defaultReadOnly")}</p>
      <ol
        aria-label={t("workflow.stages")}
        className="divide-y divide-border rounded-lg border border-border bg-card"
      >
        {workflow.stages.map((stage) => (
          <li key={stage.id} className="flex min-w-0 items-center gap-3 p-3">
            <WorkflowStatusIcon stage={stage} />
            <span className="min-w-0 text-ui-base">{stage.name}</span>
            {stage.id === workflow.initialStageId ? (
              <span className="text-ui-xs text-foreground-subtlest">{t("workflow.start")}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
