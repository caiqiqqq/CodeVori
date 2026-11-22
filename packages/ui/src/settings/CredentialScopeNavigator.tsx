import { Folder, Globe2 } from "lucide-react";
import type { CredentialScopeProject } from "@/hooks/useCredentialScope.js";

export function CredentialScopeNavigator({
  projects,
  loading,
  selectedProjectIdentity,
  isGlobalSelected,
  label,
  onGlobalSelect,
  onProjectSelect,
}: {
  projects: CredentialScopeProject[];
  loading: boolean;
  selectedProjectIdentity: string;
  isGlobalSelected: boolean;
  label: (id: string) => string;
  onGlobalSelect: () => void;
  onProjectSelect: (identity: string) => void;
}) {
  const rowClass = (selected: boolean) =>
    `flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-ui-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand ${selected ? "border-border-hover bg-card-selected text-foreground" : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground"}`;

  return (
    <nav
      aria-label={label("settings.credentials.projectsHeading")}
      className="min-w-0 rounded-xl border border-border bg-card p-2"
    >
      <h3 className="px-2 py-1.5 text-ui-sm font-semibold text-foreground-subtlest">
        {label("settings.credentials.projectsHeading")}
      </h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto md:max-h-[calc(100dvh-18rem)]">
        <li>
          <button
            type="button"
            aria-pressed={isGlobalSelected}
            className={rowClass(isGlobalSelected)}
            onClick={onGlobalSelect}
          >
            <Globe2 className="size-4 shrink-0" aria-hidden="true" />
            <span>{label("settings.credentials.globalScope")}</span>
          </button>
        </li>
        {projects.map((project) => (
          <li key={project.identity}>
            <button
              type="button"
              aria-pressed={project.identity === selectedProjectIdentity}
              title={project.workspacePath}
              className={rowClass(project.identity === selectedProjectIdentity)}
              onClick={() => onProjectSelect(project.identity)}
            >
              <Folder className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{project.label}</span>
                <span className="mt-0.5 block truncate text-ui-xs font-normal text-foreground-subtlest">
                  {project.workspacePath}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loading ? (
        <p role="status" className="px-2 py-2 text-ui-sm text-foreground-subtle">
          {label("settings.credentials.loading")}
        </p>
      ) : null}
      {!loading && projects.length === 0 ? (
        <p className="px-2 py-2 text-ui-sm text-foreground-subtle">
          {label("settings.credentials.projectsEmpty")}
        </p>
      ) : null}
    </nav>
  );
}
