import { useState } from "react";
import { ChevronRight, FolderKanban } from "lucide-react";
import {
  uuidv7,
  workTaskWorkflowSchema,
  type WorkTaskWorkflow,
  type WorkTaskWorkflowDefinition,
  type WorkTaskScope,
} from "@zcode/shared";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskError, useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { newTaskWorkflow, orderWorkflowSteps } from "@/lib/taskWorkflowDraft.js";
import { WorkflowStepList } from "./WorkflowStepList.js";
import { WorkflowStepDetail } from "./WorkflowStepDetail.js";

export function TaskWorkflowEditor({
  definition,
  scope,
  busy,
  error,
  onSave,
  onBack,
  onProjects,
}: {
  definition: WorkTaskWorkflowDefinition | null;
  scope: WorkTaskScope;
  busy: boolean;
  error: string | null;
  onSave(workflow: WorkTaskWorkflow, revision: number): Promise<boolean>;
  onBack(): void;
  onProjects(): void;
}) {
  const t = useWorkTaskMessages();
  const [draft, setDraft] = useState<WorkTaskWorkflow>(
    () => definition?.workflow ?? newTaskWorkflow((key) => t(`workflow.${key}`)),
  );
  const [revision] = useState(definition?.revision ?? 0);
  const [selection, setSelection] = useState(draft.initialStageId ?? draft.stages[0]!.id);
  const [invalid, setInvalid] = useState(false);
  const stage = draft.stages.find((item) => item.id === selection) ?? draft.stages[0]!;
  const stages = (items: WorkTaskWorkflow["stages"]) => {
    setDraft((current) => ({ ...current, stages: orderWorkflowSteps(items) }));
    setInvalid(false);
  };
  const save = async () => {
    const parsed = workTaskWorkflowSchema.safeParse(draft);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    if (await onSave(parsed.data, revision)) onBack();
  };
  return (
    <section className="min-w-0 space-y-6" data-testid="task-workflow-editor">
      <SettingsBreadcrumbReporter
        items={[{ label: definition ? draft.name : t("workflow.new") }]}
        onSectionSelect={onBack}
      />
      <nav
        className="flex items-center gap-2 text-ui-sm text-foreground-subtle"
        aria-label={t("workflow.breadcrumb")}
      >
        <button type="button" disabled={busy} onClick={onBack} className="hover:text-foreground">
          {t("workflow.libraryTitle")}
        </button>
        <ChevronRight className="size-3" />
        <span>{definition ? draft.name : t("workflow.new")}</span>
      </nav>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Input
            aria-label={t("workflow.name")}
            value={draft.name}
            placeholder={t("workflow.namePlaceholder")}
            maxLength={120}
            disabled={busy}
            className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-0 text-ui-lg font-medium shadow-none hover:bg-hover focus-visible:px-2"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Button
            disabled={busy || !draft.name.trim()}
            onClick={() => void save()}
            data-testid="workflow-save"
          >
            {t(definition ? "save" : "workflow.create")}
          </Button>
        </div>
        <Textarea
          aria-label={t("workflow.descriptionLabel")}
          value={draft.description ?? ""}
          placeholder={t("workflow.descriptionPlaceholder")}
          rows={1}
          maxLength={2000}
          disabled={busy}
          className="min-h-8 resize-none border-transparent bg-transparent px-0 py-1 text-ui-base shadow-none hover:bg-hover focus-visible:px-2"
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
        <button
          type="button"
          onClick={onProjects}
          disabled={busy}
          className="flex items-center gap-2 text-left text-ui-sm text-foreground-subtle hover:text-foreground"
        >
          <FolderKanban className="size-3.5 shrink-0" />
          {definition?.projectKeys.length
            ? t("workflow.usedBy", { count: definition.projectKeys.length })
            : t("workflow.unused")}
        </button>
      </div>
      <WorkTaskError error={invalid ? t("workflow.invalid") : error} />
      <div
        className="grid min-w-0 items-start gap-5 md:grid-cols-[minmax(200px,1fr)_minmax(0,1.9fr)]"
        data-testid="workflow-editor-columns"
      >
        <WorkflowStepList
          stages={draft.stages}
          selection={stage.id}
          initialStageId={draft.initialStageId ?? draft.stages[0]?.id}
          busy={busy}
          onSelect={setSelection}
          onChange={stages}
          onAdd={() => {
            const added = {
              id: uuidv7(),
              name: t("workflow.unnamed"),
              instructions: "",
              handoff: "none" as const,
              status: "active" as const,
            };
            const end = draft.stages.findIndex(
              (item) => item.status === "blocked" || item.status === "done",
            );
            const next = [...draft.stages];
            next.splice(end < 0 ? next.length : end, 0, added);
            stages(next);
            setSelection(added.id);
          }}
        />
        <WorkflowStepDetail
          key={stage.id}
          stage={stage}
          stages={draft.stages}
          scope={scope}
          busy={busy}
          onChange={(patch) => {
            setDraft({
              ...draft,
              stages: draft.stages.map((item) =>
                item.id === stage.id ? { ...item, ...patch } : item,
              ),
            });
            setInvalid(false);
          }}
          onRemove={() => {
            stages(draft.stages.filter((item) => item.id !== stage.id));
            setSelection(draft.initialStageId ?? draft.stages[0]!.id);
          }}
        />
      </div>
    </section>
  );
}
