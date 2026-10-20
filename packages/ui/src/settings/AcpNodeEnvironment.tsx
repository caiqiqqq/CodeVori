import type { AcpAgentInfo } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AcpCheckFact } from "@/settings/AcpAgentCheckRow.js";

/** 修复原因：环境要求来自目标 Host；页面不能用本机版本替代远端诊断。 */
export function AcpNodeEnvironment({
  info,
  notice = false,
  busy = false,
  onInstall,
}: {
  info: AcpAgentInfo;
  notice?: boolean;
  busy?: boolean;
  onInstall?: () => void;
}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const label = (key: string) => intl.formatMessage({ id: `settings.acpAgents.${key}` });
  const needsInstall =
    !info.nodeVersion || !info.npmVersion || info.nodeVersionCompatible === false;
  if (notice) {
    if (!needsInstall) return null;
    return (
      <div
        role="alert"
        data-testid="acp-node-warning"
        className="space-y-2 rounded-lg border border-warning/40 bg-surface px-3 py-2 text-ui-sm text-warning"
      >
        <p>{label("nodeInstallHint")}</p>
        <p className="break-words">
          {intl.formatMessage(
            { id: "settings.acpAgents.nodeEnvironmentSummary" },
            {
              node: info.nodeVersion ?? label("missing"),
              npm: info.npmVersion ?? label("missing"),
              range: info.nodeVersionRange ?? label("nodeRequirementUnknown"),
            },
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={
            info.nodeInstallSupported && onInstall
              ? onInstall
              : () => void platform.openExternal("https://nodejs.org/en/download")
          }
        >
          {label(info.nodeInstallSupported && onInstall ? "installNodeRuntime" : "installNode")}
        </Button>
        {info.nodeInstallSupported ? <p>{label("nodeManagedInstallHint")}</p> : null}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-2">
      <AcpCheckFact label="Node.js" value={info.nodeVersion ?? label("missing")} technical />
      <AcpCheckFact label="npm" value={info.npmVersion ?? label("missing")} technical />
      {info.nodeRuntimeSource === "managed" ? <p>{label("nodeManagedSource")}</p> : null}
      <AcpCheckFact
        label={label("nodeVersionRange")}
        value={info.nodeVersionRange ?? label("nodeRequirementUnknown")}
        technical={Boolean(info.nodeVersionRange)}
      />
      <p className="text-ui-sm text-foreground-subtle">{label("nodeHostHint")}</p>
    </div>
  );
}
