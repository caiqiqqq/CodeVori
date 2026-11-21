import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { useTaskWorkflows } from "@/hooks/useTaskWorkflows.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { WorkTaskError, useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";

export function ProjectWorkflowSelect({
  panel,
  loading,
  remote,
}: {
  panel: WorkTaskPanel | null;
  loading: boolean;
  remote: boolean;
}) {
  const t = useWorkTaskMessages();
  const catalog = useTaskWorkflows();
  if (remote)
    return <span className="text-ui-sm text-foreground-subtle">{t("remoteUnsupported")}</span>;
  if (!panel)
    return (
      <span className="text-ui-sm text-foreground-subtle">
        {t(loading ? "loading" : "workflow.mainProject")}
      </span>
    );
  return (
    <div className="w-full min-w-0 space-y-1 md:w-56">
      <Select
        value={panel.board?.workflow?.id ?? "none"}
        disabled={
          loading ||
          panel.loading ||
          panel.busy ||
          catalog.loading ||
          !panel.executable ||
          panel.board?.workflowRevision === undefined ||
          !!catalog.error
        }
        onValueChange={(value) =>
          void panel.saveWorkflow(
            value === "none" ? null : value,
            panel.board?.workflowRevision ?? 0,
          )
        }
      >
        <SelectTrigger aria-label={t("workflow.projectSelection")} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("workflow.default")}</SelectItem>
          {catalog.definitions.map((item) => (
            <SelectItem key={item.workflow.id} value={item.workflow.id}>
              {item.workflow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <WorkTaskError error={panel.error ?? catalog.error} />
    </div>
  );
}
