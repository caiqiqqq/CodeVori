import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Bot, Users } from "lucide-react";
import { AgentProfilesSection } from "@/settings/AgentProfilesSection.js";
import { AgentSquadsSection } from "@/settings/AgentSquadsSection.js";
import type { AgentSettingsView } from "@/lib/settingsNavigation.js";

export function AgentsAndSquadsSection({
  view,
  onViewChange,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: {
  view: AgentSettingsView;
  onViewChange: (view: AgentSettingsView) => void;
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}) {
  const { intl } = useZCodeIntl();
  const groups: Array<{
    label: string;
    items: Array<{ value: AgentSettingsView; label: string; icon: typeof Bot }>;
  }> = [
    {
      label: intl.formatMessage({ id: "agentProfiles.title" }),
      items: [
        {
          value: "agents",
          label: intl.formatMessage({ id: "agentsAndSquads.allAgents" }),
          icon: Bot,
        },
      ],
    },
    {
      label: intl.formatMessage({ id: "agentsAndSquads.squadsAndMembers" }),
      items: [{ value: "squads", label: intl.formatMessage({ id: "squads.title" }), icon: Users }],
    },
  ];
  const selectedLabel = groups
    .flatMap((group) => group.items)
    .find((item) => item.value === view)?.label;

  return (
    <div
      data-testid="agents-and-squads-view"
      className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-[minmax(170px,220px)_minmax(0,1fr)] md:gap-7"
    >
      <nav
        aria-label={intl.formatMessage({ id: "settings.navLabel" })}
        className="min-w-0 space-y-5 md:border-r md:border-border md:pr-4"
      >
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="space-y-1">
            <h3 className="px-2 py-1 text-ui-sm font-medium text-foreground-subtlest">
              {group.label}
            </h3>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = view === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onViewChange(item.value)}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-ui-base transition-colors ${active ? "bg-selected text-foreground" : "text-foreground-subtle hover:bg-hover hover:text-foreground"}`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>
      <section aria-label={selectedLabel} className="min-w-0">
        {view === "agents" ? (
          <AgentProfilesSection
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            remoteSessionId={remoteSessionId}
            remoteTarget={remoteTarget}
          />
        ) : (
          <AgentSquadsSection
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            remoteSessionId={remoteSessionId}
            remoteTarget={remoteTarget}
          />
        )}
      </section>
    </div>
  );
}
