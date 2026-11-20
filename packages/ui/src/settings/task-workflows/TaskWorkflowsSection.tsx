import { useState } from "react";
import { Plus, Workflow, ArrowUpRight, Trash2 } from "lucide-react";
import type { WorkTaskWorkflowDefinition } from "@zcode/shared";
import { useTaskWorkflows } from "@/hooks/useTaskWorkflows.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskError, useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";
import { TaskWorkflowEditor } from "./TaskWorkflowEditor.js";

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
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {catalog.definitions.map((definition) => (
          <li key={definition.workflow.id} className="flex min-w-0 items-center gap-3 px-4 py-4">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
              onClick={() => setEditor({ definition })}
            >
              <Workflow className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0">
                <span className="block text-ui-base font-medium">{definition.workflow.name}</span>
                {definition.workflow.description ? (
                  <span className="mt-1 block text-ui-sm text-foreground-subtle">
                    {definition.workflow.description}
                  </span>
                ) : null}
                <span className="mt-2 block text-ui-sm text-foreground-subtlest">
                  {t("workflow.summary", {
                    steps: definition.workflow.stages.filter((item) => item.enabled !== false)
                      .length,
                    projects: definition.projectKeys.length,
                  })}
                </span>
              </span>
            </button>
            <ArrowUpRight className="size-4 text-foreground-subtle" />
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
        <div className="space-y-2 py-12 text-center">
          <Workflow className="mx-auto size-6 text-foreground-subtlest" />
          <p className="text-ui-base">{t("workflow.empty")}</p>
          <p className="text-ui-sm text-foreground-subtle">{t("workflow.emptyHelp")}</p>
        </div>
      ) : null}
      <Button variant="ghost" onClick={onProjects}>
        {t("workflow.chooseForProject")}
        <ArrowUpRight className="size-3.5" />
      </Button>
    </section>
  );
}
