import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useProjectManagement } from "@/hooks/useProjectManagement.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProjectsSection() {
  const { intl } = useZCodeIntl();
  const t = (key: string, values?: Record<string, number>) =>
    intl.formatMessage({ id: `settings.projects.${key}` }, values);
  const { projects, busy, remove } = useProjectManagement();
  const confirm = useConfirmDialog();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState("");
  const filtered = projects.filter((entry) =>
    `${entry.label} ${entry.workspacePath} ${entry.workspaceIdentity ?? ""}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase().trim()),
  );
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
          disabled={busy || !filtered.length}
          onClick={() => setSelected(new Set(filtered.map((entry) => entry.key)))}
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
      <ul className="divide-y divide-border rounded-lg border border-border">
        {filtered.map((entry) => (
          <li key={entry.key} className="flex items-center gap-3 p-3">
            <Checkbox
              aria-label={entry.label}
              checked={selected.has(entry.key)}
              disabled={busy}
              onCheckedChange={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(entry.key);
                  else next.delete(entry.key);
                  return next;
                })
              }
            />
            <div className="min-w-0">
              <p className="truncate text-ui-sm font-medium">{entry.label}</p>
              <p
                className="truncate text-ui-xs text-foreground-subtle"
                title={entry.workspaceIdentity || entry.workspacePath}
              >
                {entry.workspaceIdentity || entry.workspacePath}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {!filtered.length && <p className="text-ui-sm text-foreground-subtle">{t("empty")}</p>}
      {result && (
        <p role="status" className="whitespace-pre-wrap text-ui-sm">
          {result}
        </p>
      )}
    </section>
  );
}
