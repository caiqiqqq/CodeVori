import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsSegmentedTabs } from "@/settings/SettingsSegmentedTabs.js";
import { SubagentsSection } from "@/settings/SubagentsSection.js";
import { DelegationSettingsSection } from "@/settings/DelegationSettingsSection.js";
import type { AgentSettingsView } from "@/lib/settingsNavigation.js";

export function AgentsAndSquadsSection({
  view,
  onViewChange,
  onManageModels,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: {
  view: AgentSettingsView;
  onViewChange: (view: AgentSettingsView) => void;
  onManageModels: () => void;
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}) {
  const { intl } = useZCodeIntl();
  const views: Array<{ value: AgentSettingsView; label: string }> = [
    { value: "agents", label: intl.formatMessage({ id: "agentProfiles.title" }) },
    { value: "squads", label: intl.formatMessage({ id: "squads.title" }) },
  ];

  return (
    <div className="w-full space-y-5">
      <SettingsSegmentedTabs items={views} value={view} onValueChange={onViewChange} />
      <section aria-label={views.find((item) => item.value === view)?.label}>
        {view === "agents" ? (
          <SubagentsSection
            onManageModels={onManageModels}
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
          />
        ) : (
          <DelegationSettingsSection
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
