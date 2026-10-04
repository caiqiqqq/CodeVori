import { CircleIcon } from "lucide-react";
import { useState } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpAgent } from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { AcpAgentManagerPanel } from "@/settings/AcpAgentManagerPanel.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";
import { useAcpAgentManagement } from "@/settings/useAcpAgentManagement.js";
import { ACP_AGENT_SETTINGS_CATALOG } from "@/settings/acpAgentSettingsCatalog.js";

interface AcpAgentsSectionProps {
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}

function AcpAgentsContent({
  agent,
  service,
  waiting,
  onAgentChange,
}: {
  agent: AcpAgent;
  service: IAcpService | null;
  waiting: boolean;
  onAgentChange: (agent: AcpAgent) => void;
}) {
  const { intl } = useZCodeIntl();
  const management = useAcpAgentManagement(service);

  return (
    <div className="space-y-4" data-testid="settings-acp-agents">
      <div className="flex items-start justify-between gap-3">
        <p className="text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.acpAgents.description" })}
        </p>
        <SettingsResourceHeaderActions
          onRefresh={() => void management.refresh()}
          refreshing={management.loading || management.checking}
          refreshDisabled={!service || management.busy || management.loading || management.checking}
          refreshLabel={intl.formatMessage({ id: "settings.acpAgents.checkUpdates" })}
          refreshTestId="settings-acp-agents-refresh"
        />
      </div>

      <div className="grid min-h-[36rem] grid-cols-[56px_minmax(0,1fr)] gap-3 md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-xl border border-border bg-card px-1.5 py-3 md:max-h-[calc(100dvh-12rem)] md:overflow-y-auto md:px-2 md:py-2">
          <div className="flex h-7 items-center px-2 py-1 max-md:hidden">
            <h3 className="text-ui-sm font-semibold text-foreground-subtlest">
              {intl.formatMessage({ id: "settings.acpAgents.list" })}
            </h3>
          </div>
          <div
            className="flex min-h-0 flex-col gap-1 max-md:items-center"
            aria-label={intl.formatMessage({ id: "settings.acpAgents.list" })}
          >
            {ACP_AGENT_SETTINGS_CATALOG.map((item) => {
              const info = management.agents.find((entry) => entry.agent === item.agent);
              const status = !info
                ? null
                : !info.enabled
                  ? "disabled"
                  : info.ready
                    ? "ready"
                    : "missing";
              return (
                <ControlHintTooltip key={item.agent} title={item.name} side="right">
                  <button
                    type="button"
                    aria-label={item.name}
                    aria-pressed={agent === item.agent}
                    data-state={agent === item.agent ? "selected" : "idle"}
                    data-testid={`settings-acp-agent-${item.agent}`}
                    onClick={() => onAgentChange(item.agent)}
                    className={`relative box-border flex h-8 w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-ui-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand max-md:size-8 max-md:justify-center max-md:gap-0 max-md:px-0 ${agent === item.agent ? "border-border-hover bg-card-selected text-foreground" : "border-transparent text-foreground hover:border-border-hover/60"}`}
                  >
                    <AcpAgentIcon agent={item.agent} />
                    <span className="min-w-0 flex-1 truncate max-md:sr-only">{item.name}</span>
                    {status ? (
                      <CircleIcon
                        data-acp-agent-status={status}
                        aria-label={intl.formatMessage({ id: `settings.acpAgents.${status}` })}
                        className={`size-2 shrink-0 fill-current max-md:absolute max-md:right-1 max-md:bottom-1 max-md:rounded-full max-md:ring-2 max-md:ring-card ${status === "ready" ? "text-success" : status === "missing" ? "text-warning" : "text-foreground-subtlest"}`}
                      />
                    ) : null}
                  </button>
                </ControlHintTooltip>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0" data-testid={`settings-acp-agent-detail-${agent}`}>
          <AcpAgentManagerPanel
            agent={agent}
            service={service}
            serviceAvailable={Boolean(service)}
            waiting={waiting}
            management={management}
          />
        </div>
      </div>
    </div>
  );
}

export function AcpAgentsSection({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: AcpAgentsSectionProps) {
  const [agent, setAgent] = useState<AcpAgent>("codex");
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const baseServices = useBaseWorkspaceServices();
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    workspacePath,
    resolution.remoteSessionId,
    resolution.rpcReady,
  ]);

  return (
    <AcpAgentsContent
      key={targetKey}
      agent={agent}
      service={
        !workspacePath
          ? baseServices.acpService
          : resolution.rpcReady
            ? resolution.services.acpService
            : null
      }
      waiting={Boolean(workspacePath && !resolution.rpcReady)}
      onAgentChange={setAgent}
    />
  );
}
