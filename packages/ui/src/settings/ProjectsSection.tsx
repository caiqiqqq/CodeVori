import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useAgentBoardWorkTasks } from "@/hooks/useAgentBoardWorkTasks.js";
import { useWorktreeProjectGroups } from "@/hooks/useWorktreeProjectGroups.js";
import { workTaskNavigationKey } from "@/store/workTaskNavigationStore.js";
import { ProjectWorkflowSelect } from "./task-workflows/ProjectWorkflowSelect.js";
import { useProjectManagement } from "@/hooks/useProjectManagement.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProjectsSection() {
  const { intl } = useZCodeIntl();
  const t = (key: string, values?: Record<string, number>) =>
    intl.formatMessage({ id: `settings.projects.${key}` }, values);
  const { projects, busy, remove } = useProjectManagement();
  const workflowTabs = useMemo(
    () => projects.map((project) => ({ ...project, id: project.key, kind: "workspace" as const })),
    [projects],
  );
  const projectGroups = useWorktreeProjectGroups(workflowTabs);
  const workflows = useAgentBoardWorkTasks(workflowTabs);
  const confirm = useConfirmDialog();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState("");
  const query = search.toLocaleLowerCase().trim();
  const linkedByMain = new Map<string, string[]>();
  for (const group of projectGroups) {
    const parent = group.tab.workspacePath;
    const children = group.worktrees
      .map(({ tab }) => tab.workspacePath)
      .filter((path) => projects.some((project) => project.key === path));
    if (children.length) linkedByMain.set(parent, children);
  }
  const linkedKeys = new Set([...linkedByMain.values()].flat());
  const visibleGroups = projects
    .filter((entry) => !linkedKeys.has(entry.key))
    .map((entry) => {
      const children = (linkedByMain.get(entry.key) ?? [])
        .map((key) => projects.find((project) => project.key === key)!)
        .filter((child) =>
          `${child.label} ${child.workspacePath} ${child.workspaceIdentity ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        );
      const matches = `${entry.label} ${entry.workspacePath} ${entry.workspaceIdentity ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
      return { entry, children, matches };
    })
    .filter(({ matches, children }) => !query || matches || children.length > 0);
  const visibleEntries = visibleGroups.flatMap(({ entry, children }) => [entry, ...children]);
  return (
    <section className="space-y-4" data-testid="settings-projects">
      <p className="text-ui-sm text-foreground-subtle">{t("description")}</p>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !visibleEntries.length}
          onClick={() => setSelected(new Set(visibleEntries.map((entry) => entry.key)))}
        >
          {t("selectAll")}
        </Button>
        <Button
          variant="destructive"
          disabled={busy || !selected.size}
          onClick={async () => {
            let cleanData = false;
            const keys = new Set(selected);
            if (
              !(await confirm({
                title: t("removeTitle", { count: keys.size }),
                description: t("removeDescription"),
                confirmVariant: "destructive",
                checkbox: {
                  label: t("cleanData"),
                  onCheckedChange: (value) => {
                    cleanData = value;
                  },
                },
              }))
            )
              return;
            const outcome = await remove(keys, cleanData);
            setResult([t("removed", { count: outcome.removed }), ...outcome.errors].join("\n"));
            setSelected(new Set());
          }}
        >
          {t("remove", { count: selected.size })}
        </Button>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {visibleGroups.map(({ entry, children }) => (
          <li key={entry.key} data-testid="project-group">
            <ProjectRow
              entry={entry}
              selected={selected.has(entry.key)}
              busy={busy}
              onSelect={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(entry.key);
                  else next.delete(entry.key);
                  return next;
                })
              }
            >
              <ProjectWorkflowSelect
                panel={
                  workflows.projectTabs.some(
                    (tab) => workTaskNavigationKey(tab) === workTaskNavigationKey(entry),
                  )
                    ? workflows.forScope(entry)
                    : null
                }
                loading={workflows.projectsLoading}
                remote={!!(entry.workspaceIdentity || entry.remoteSessionId || entry.remoteTarget)}
              />
            </ProjectRow>
            {children.length ? (
              <ul className="border-t border-border/60 bg-surface/40">
                {children.map((child) => (
                  <li key={child.key} data-testid="project-worktree-row">
                    <ProjectRow
                      entry={child}
                      selected={selected.has(child.key)}
                      busy={busy}
                      nested
                      onSelect={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(child.key);
                          else next.delete(child.key);
                          return next;
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {!visibleGroups.length && <p className="text-ui-sm text-foreground-subtle">{t("empty")}</p>}
      {result && (
        <p role="status" className="whitespace-pre-wrap text-ui-sm">
          {result}
        </p>
      )}
    </section>
  );
}

function ProjectRow({
  entry,
  selected,
  busy,
  nested = false,
  onSelect,
  children,
}: {
  entry: ReturnType<typeof useProjectManagement>["projects"][number];
  selected: boolean;
  busy: boolean;
  nested?: boolean;
  onSelect(checked: boolean): void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-3 p-3 ${nested ? "ps-10" : ""}`}>
      <Checkbox
        aria-label={entry.label}
        checked={selected}
        disabled={busy}
        onCheckedChange={(checked) => onSelect(checked === true)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-sm font-medium">{entry.label}</p>
        <p
          className="truncate text-ui-xs text-foreground-subtle"
          title={entry.workspaceIdentity || entry.workspacePath}
        >
          {entry.workspaceIdentity || entry.workspacePath}
        </p>
      </div>
      {children}
    </div>
  );
}
