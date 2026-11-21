import { useState } from "react";
import { Plus, Workflow, ArrowUpRight, Trash2, ChevronRight } from "lucide-react";
import type { WorkTaskWorkflowDefinition } from "@zcode/shared";
import { useTaskWorkflows } from "@/hooks/useTaskWorkflows.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskError, useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { TaskWorkflowEditor } from "./TaskWorkflowEditor.js";
import { WorkflowStatusIcon } from "./WorkflowStepList.js";

export function TaskWorkflowsSection() {
  const catalog = useTaskWorkflows();
  const t = useWorkTaskMessages();
  const confirm = useConfirmDialog();
  const [editor, setEditor] = useState<{ definition: WorkTaskWorkflowDefinition | null } | null>(
    null,
  );
  const local = useTabStore((state) =>
    state.tabs.find(
      (tab) =>
        tab.kind === "workspace" &&
        !tab.workspaceIdentity &&
        !tab.remoteSessionId &&
        !tab.remoteTarget,
    ),
  );
  const onProjects = () => setPendingSettingsSection("projects");
  if (editor)
    return (
      <TaskWorkflowEditor
        key={editor.definition?.workflow.id ?? "new"}
        definition={editor.definition}
        scope={{ workspacePath: local?.kind === "workspace" ? local.workspacePath : "" }}
        busy={catalog.busy}
        error={catalog.error}
        onBack={() => setEditor(null)}
        onSave={catalog.save}
        onProjects={onProjects}
      />
    );
  return (
    <section className="min-w-0 space-y-5" data-testid="task-workflows-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-ui-base leading-6 text-foreground-subtle">
          {t("workflow.libraryDescription")}
        </p>
        <Button
          disabled={catalog.busy || catalog.loading || !!catalog.error}
          onClick={() => setEditor({ definition: null })}
          data-testid="workflow-new"
        >
          <Plus className="size-4" />
          {t("workflow.new")}
        </Button>
      </div>
      <WorkTaskError error={catalog.error} />
      {catalog.error ? (
        <Button variant="outline" onClick={() => void catalog.refresh()}>
          {t("retry")}
        </Button>
      ) : null}
      {catalog.loading ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {t("loading")}
        </p>
      ) : null}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {catalog.definitions.map((definition) => (
          <li
            key={definition.workflow.id}
            className="flex min-w-0 flex-col gap-3 px-4 py-4 md:flex-row md:items-center"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col gap-3 text-left sm:flex-row sm:items-start"
              onClick={() => setEditor({ definition })}
            >
              <Workflow className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-ui-base font-medium">{definition.workflow.name}</span>
                  <span className="text-ui-xs text-foreground-subtlest">
                    {t("workflow.summary", {
                      steps: definition.workflow.stages.filter((item) => item.enabled !== false)
                        .length,
                      projects: definition.projectKeys.length,
                    })}
                  </span>
                </span>
                {definition.workflow.description ? (
                  <span className="mt-1 block text-ui-sm text-foreground-subtle">
                    {definition.workflow.description}
                  </span>
                ) : null}
                <ol
                  aria-label={definition.workflow.name}
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-y-1 text-ui-xs"
                  data-testid="workflow-stage-preview"
                >
                  {definition.workflow.stages
                    .filter((stage) => stage.enabled !== false)
                    .map((stage, index) => (
                      <li key={stage.id} className="inline-flex min-w-0 items-center gap-1">
                        {index ? (
                          <ChevronRight
                            aria-hidden="true"
                            className="mx-1 size-3 shrink-0 text-foreground-subtlest"
                          />
                        ) : null}
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                          <WorkflowStatusIcon stage={stage} />
                          <span className="max-w-36 truncate">{stage.name}</span>
                        </span>
                      </li>
                    ))}
                </ol>
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              disabled={catalog.busy || definition.projectKeys.length > 0}
              title={definition.projectKeys.length ? t("workflow.inUse") : undefined}
              aria-label={t("workflow.delete", { name: definition.workflow.name })}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("workflow.delete", { name: definition.workflow.name }),
                    description: t("workflow.deleteHelp"),
                    confirmVariant: "destructive",
                  })
                )
                  await catalog.remove(definition.workflow.id, definition.revision);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {!catalog.loading && !catalog.definitions.length ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 border-y border-border py-8 text-center">
          <Workflow className="size-5 text-foreground-subtlest" />
          <p className="text-ui-base font-medium">{t("workflow.empty")}</p>
          <p className="max-w-md text-ui-sm text-foreground-subtle">{t("workflow.emptyHelp")}</p>
          <Button
            variant="outline"
            className="mt-2"
            disabled={catalog.busy || catalog.loading || !!catalog.error}
            onClick={() => setEditor({ definition: null })}
          >
            <Plus className="size-4" />
            {t("workflow.new")}
          </Button>
        </div>
      ) : null}
      <Button variant="ghost" onClick={onProjects}>
        {t("workflow.chooseForProject")}
        <ArrowUpRight className="size-3.5" />
      </Button>
    </section>
  );
}
