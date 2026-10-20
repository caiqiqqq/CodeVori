import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { AcpAgent } from "@zcode/shared";
import type { IAcpService } from "@zcode/services";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { AcpNodeEnvironment } from "@/settings/AcpNodeEnvironment.js";
import { AcpCheckFact, AcpCheckRow } from "@/settings/AcpAgentCheckRow.js";
import { AcpAgentEnvironmentEditor } from "@/settings/AcpAgentEnvironmentEditor.js";
import { AcpCodexConfigEditor } from "@/settings/AcpCodexConfigEditor.js";
import {
  clearAcpEnvDraftIfUnchanged,
  normalizeAcpAgentEnvText,
} from "@/settings/acpAgentEnvironment.js";
import {
  formatAcpEnv,
  parseAcpEnv,
  useAcpAgentManagement,
} from "@/settings/useAcpAgentManagement.js";
import {
  ACP_AGENT_SETTINGS_CATALOG,
  compareAcpAdapterVersions,
  projectAcpAgentChecks,
  shouldOfferManagedAcpInstall,
  type AcpAgentCheckId,
  type AcpAgentCheckStatus,
} from "@/settings/acpAgentSettingsCatalog.js";

interface Props {
  agent: AcpAgent;
  service: IAcpService | null;
  serviceAvailable: boolean;
  waiting: boolean;
  management: ReturnType<typeof useAcpAgentManagement>;
}

/** Scoped to the target Host. A new Host remounts this panel and discards stale drafts. */
export function AcpAgentManagerPanel({
  agent,
  service,
  serviceAvailable,
  waiting,
  management,
}: Props) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const [envDrafts, setEnvDrafts] = useState<Partial<Record<AcpAgent, string>>>({});
  const catalogItem = ACP_AGENT_SETTINGS_CATALOG.find((item) => item.agent === agent)!;
  const agentInfo = management.agents.find((item) => item.agent === agent);
  const checks = agentInfo ? projectAcpAgentChecks(agentInfo) : [];
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>({});
  const isOpen = (id: AcpAgentCheckId, status: AcpAgentCheckStatus) =>
    expandedChecks[`${agent}:${id}`] ?? (status === "warn" || status === "fail");
  const allExpanded = checks.every(({ id, status }) => isOpen(id, status));
  const setCheckOpen = (id: AcpAgentCheckId, open: boolean) => {
    setExpandedChecks((previous) => ({ ...previous, [`${agent}:${id}`]: open }));
  };
  const envText = envDrafts[agent] ?? formatAcpEnv(agentInfo?.env ?? {});
  const envChanged = Boolean(agentInfo && envText !== formatAcpEnv(agentInfo.env));
  const label = (key: string) => intl.formatMessage({ id: `settings.acpAgents.${key}` });
  const managedIsNewer = Boolean(
    agentInfo?.managedVersion &&
    compareAcpAdapterVersions(agentInfo.managedVersion, agentInfo.registryVersion) === 1,
  );
  const updateAvailable =
    agentInfo &&
    compareAcpAdapterVersions(agentInfo.installedVersion, agentInfo.registryVersion) === -1;
  const manage = (action: "install" | "upgrade" | "uninstall") => {
    if (action === "uninstall" || (action === "install" && agentInfo?.source === "system")) {
      const installingOverSystem = action === "install";
      void confirmDialog({
        title: label(action),
        description: installingOverSystem
          ? intl.formatMessage(
              { id: "settings.acpAgents.systemInstallConfirm" },
              {
                current: agentInfo?.installedVersion ?? label("unknown"),
                target: agentInfo?.registryVersion ?? label("unknown"),
              },
            )
          : label("uninstallConfirm"),
        confirmLabel: label(action),
      }).then((confirmed) => {
        if (confirmed) void management.manage(agent, action, agentInfo?.registryVersion);
      });
      return;
    }
    void management.manage(agent, action, agentInfo?.registryVersion);
  };
  const operationLog =
    management.log.length && management.operationAgent === agent ? (
      <div
        role="log"
        className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-surface px-3 py-2 font-mono text-ui-sm text-foreground-subtle"
      >
        {management.log.map((entry, index) => (
          <p key={`${index}:${entry}`}>{entry}</p>
        ))}
      </div>
    ) : null;

  return (
    <div
      className="flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card md:max-h-[calc(100dvh-12rem)]"
      data-testid="settings-acp-agent-manager"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AcpAgentIcon agent={agent} className="size-5" />
            <h3 className="min-w-0 text-ui-lg font-semibold text-foreground">{catalogItem.name}</h3>
            <Badge variant="outline">
              {agentInfo?.distribution === "binary" ? label("binary") : "npm"}
            </Badge>
            <Badge variant="secondary">{label("adapterBadge")}</Badge>
          </div>
          {agentInfo ? (
            <Switch
              className="after:-inset-x-1"
              checked={agentInfo.enabled}
              disabled={management.busy}
              aria-label={label("enabled")}
              onCheckedChange={(enabled) => {
                void management.update({ agent, enabled }).catch(() => {});
              }}
            />
          ) : null}
        </div>
        <p className="mt-2 text-ui-sm leading-5 text-foreground-subtle">
          {intl.formatMessage({ id: catalogItem.descriptionId })}
        </p>
      </div>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
        {management.error ? (
          <p role="alert" className="break-words text-ui-sm text-destructive">
            {management.error}
          </p>
        ) : null}
        {!serviceAvailable ? (
          <p className="text-ui-base text-foreground-subtle">
            {waiting ? label("connecting") : label("loadFailed")}
          </p>
        ) : management.loading ? (
          <p className="text-ui-base text-foreground-subtle">{label("checking")}</p>
        ) : agentInfo ? (
          <>
            {agentInfo.distribution !== "binary" ? (
              <AcpNodeEnvironment info={agentInfo} notice />
            ) : null}
            <section className="space-y-2" aria-label={label("diagnostics")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  {intl.formatMessage(
                    { id: "settings.acpAgents.checksCount" },
                    { count: checks.length },
                  )}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const nextOpen = !allExpanded;
                    setExpandedChecks((previous) => ({
                      ...previous,
                      ...Object.fromEntries(checks.map(({ id }) => [`${agent}:${id}`, nextOpen])),
                    }));
                  }}
                >
                  {label(allExpanded ? "collapseChecks" : "expandChecks")}
                </Button>
              </div>
              <p className="text-ui-sm text-foreground-subtle">{label("checksHint")}</p>
              {checks.map(({ id, status }) => (
                <AcpCheckRow
                  key={id}
                  id={id}
                  title={label(`check${id[0]!.toUpperCase()}${id.slice(1)}`)}
                  status={status}
                  open={isOpen(id, status)}
                  onOpenChange={(open) => setCheckOpen(id, open)}
                >
                  {id === "node" ? (
                    <AcpNodeEnvironment info={agentInfo} />
                  ) : id === "adapter" ? (
                    <>
                      <AcpCheckFact
                        label={label("status")}
                        value={agentInfo.ready ? label("ready") : label("missing")}
                      />
                      <AcpCheckFact label={label("command")} value={agentInfo.command} technical />
                      <AcpCheckFact
                        label={label("arguments")}
                        value={agentInfo.args?.join(" ") || "—"}
                        technical
                      />
                      <AcpCheckFact label={label("source")} value={label(agentInfo.source)} />
                      <AcpCheckFact
                        label={label("adapterPath")}
                        value={agentInfo.executablePath ?? label("missing")}
                        technical
                      />
                      <p className="text-ui-sm text-foreground-subtle">{label("adapterHint")}</p>
                    </>
                  ) : id === "version" ? (
                    <>
                      <AcpCheckFact
                        label={label("installedVersion")}
                        value={agentInfo.installedVersion ?? label("unknown")}
                        technical
                      />
                      <AcpCheckFact
                        label={label("registryVersion")}
                        value={agentInfo.registryVersion}
                        technical
                      />
                      {management.checking ? (
                        <p role="status" className="text-ui-sm text-foreground-subtle">
                          {label("checkingUpdates")}
                        </p>
                      ) : agentInfo.updateCheck?.status === "error" ? (
                        <p
                          data-testid="acp-update-check-error"
                          role="status"
                          className="text-ui-sm text-warning"
                        >
                          {label("updateCheckFailed")}
                        </p>
                      ) : agentInfo.updateCheck?.status === "unavailable" ? (
                        <p role="status" className="text-ui-sm text-foreground-subtle">
                          {label("updateCheckUnavailable")}
                        </p>
                      ) : agentInfo.updateCheck?.status === "unchecked" ? (
                        <p className="text-ui-sm text-foreground-subtle">
                          {label("updateUnchecked")}
                        </p>
                      ) : null}
                      {updateAvailable ? (
                        <p data-testid="acp-update-available" className="text-ui-sm text-warning">
                          {intl.formatMessage(
                            { id: "settings.acpAgents.updateAvailable" },
                            { version: agentInfo.registryVersion },
                          )}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {shouldOfferManagedAcpInstall(agentInfo) ? (
                          <Button
                            type="button"
                            size="sm"
                            data-testid="acp-install"
                            disabled={
                              management.busy ||
                              management.checking ||
                              envChanged ||
                              agentInfo.platformSupported === false ||
                              (agentInfo.distribution !== "binary" &&
                                (!agentInfo.nodeVersion ||
                                  !agentInfo.npmVersion ||
                                  agentInfo.nodeVersionCompatible === false))
                            }
                            onClick={() => manage("install")}
                          >
                            {label("install")}
                          </Button>
                        ) : agentInfo.managedVersion ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              data-testid="acp-upgrade"
                              variant="outline"
                              disabled={
                                management.busy ||
                                management.checking ||
                                envChanged ||
                                agentInfo.platformSupported === false ||
                                (agentInfo.distribution !== "binary" &&
                                  (!agentInfo.nodeVersion ||
                                    !agentInfo.npmVersion ||
                                    agentInfo.nodeVersionCompatible === false)) ||
                                agentInfo.managedVersion === agentInfo.registryVersion ||
                                managedIsNewer
                              }
                              onClick={() => manage("upgrade")}
                            >
                              {label("upgrade")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={management.busy}
                              onClick={() => manage("uninstall")}
                            >
                              {label("uninstall")}
                            </Button>
                          </>
                        ) : null}
                      </div>
                      {envChanged && agentInfo.distribution === "npm" ? (
                        <p className="text-ui-sm text-foreground-subtle">
                          {label("saveBeforeInstall")}
                        </p>
                      ) : null}
                      {agentInfo.platformSupported === false ? (
                        <p className="text-ui-sm text-foreground-subtle">
                          {label("unsupportedPlatform")}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </AcpCheckRow>
              ))}
              {operationLog}
            </section>

            {/* 修复原因：Codex 原生配置优先于旧的 OPENAI_* 环境变量，重复编辑器会误导认证来源。 */}
            {agent === "codex" && service ? (
              <AcpCodexConfigEditor key="codex-native-config" service={service} />
            ) : null}
            {agent !== "codex" ? (
              <AcpAgentEnvironmentEditor
                key={`environment:${agent}`}
                info={agentInfo}
                service={service}
                text={envText}
                changed={envChanged}
                busy={management.busy}
                onChange={(text) => setEnvDrafts((previous) => ({ ...previous, [agent]: text }))}
                onSave={async (submitted) => {
                  // 修复原因：高级文本可直接修改认证方式，保存时仍需按 Codeg 的规则去掉互斥凭据。
                  const env = parseAcpEnv(normalizeAcpAgentEnvText(agent, submitted));
                  await management.update({ agent, env });
                  // 修复原因：旧保存回执不能清空等待期间的新草稿；所有编辑入口共用这一份文本。
                  setEnvDrafts((previous) => ({
                    ...previous,
                    [agent]: clearAcpEnvDraftIfUnchanged(previous[agent], submitted),
                  }));
                }}
              />
            ) : null}
            {agent !== "codex" ? (
              <p className="text-ui-sm text-foreground-subtle">{label("restartHint")}</p>
            ) : null}
          </>
        ) : null}
        {!agentInfo ? operationLog : null}
      </div>
    </div>
  );
}
