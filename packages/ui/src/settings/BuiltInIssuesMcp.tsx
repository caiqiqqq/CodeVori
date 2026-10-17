import { useState } from "react";
import { Cable } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { FORGE_ISSUES_MCP_NAME } from "@zcode/shared";
import { Switch } from "@/components/ui/switch.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsResourceGroupHeader } from "@/settings/SettingsResourceGroup.js";

export function isBuiltInIssuesMcpVisible(input: {
  scope: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remote: boolean;
  query: string;
  title: string;
}): boolean {
  return (
    input.scope === "user" &&
    !input.workspaceIdentity?.trim() &&
    !input.remoteSessionId &&
    !input.remote &&
    `${FORGE_ISSUES_MCP_NAME} ${input.title} MCP GitHub GitLab Gitea`
      .toLowerCase()
      .includes(input.query.trim().toLowerCase())
  );
}

export function BuiltInIssuesMcp({ services }: { services: IServiceAccessor }) {
  const { intl } = useZCodeIntl();
  const { settings, loading, error, update } = useSettings(services);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = intl.formatMessage({ id: "settings.mcp.issues.title" });
  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setFailed(false);
    try {
      await update({ forgeIssuesMcpEnabled: enabled });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-4" data-testid="built-in-issues-mcp">
      <SettingsResourceGroupHeader
        count={1}
        title={intl.formatMessage({ id: "settings.mcp.builtIn" })}
      />
      <div className="rounded-xl bg-surface px-4 py-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-background text-foreground-subtle">
            <Cable className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">{title}</div>
            <div className="break-words text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.mcp.issues.description" })}
            </div>
          </div>
          <Switch
            aria-label={intl.formatMessage({ id: "settings.mcp.issues.toggle" })}
            checked={settings?.forgeIssuesMcpEnabled !== false}
            disabled={loading || !settings || saving}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
        </div>
        <p className="mt-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.mcp.issues.reconnect" })}
        </p>
        {failed || error ? (
          <p role="alert" className="mt-2 text-ui-sm text-destructive">
            {intl.formatMessage({ id: "settings.mcp.issues.saveFailed" })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
