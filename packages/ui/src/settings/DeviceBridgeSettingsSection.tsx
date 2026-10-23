import { Network, RefreshCw } from "lucide-react";
import { getDeviceBridgeErrorCode } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useDeviceBridgeSettings } from "@/hooks/useDeviceBridgeSettings.js";
import { SettingsGroupCard, SettingsRow } from "./SettingsPageParts.js";

export function DeviceBridgeSettingsSection() {
  const { intl } = useZCodeIntl();
  const { state, busy, error, run, selectComponent } = useDeviceBridgeSettings();
  const t = (name: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `settings.devices.${name}` }, values);
  const active = state?.phase === "running" || state?.phase === "starting";
  const authorized = state?.backendState === "Running";
  const status = !active
    ? "stopped"
    : authorized
      ? "authorized"
      : state?.backendState === "NeedsMachineAuth"
        ? "needsApproval"
        : "needsLogin";
  // 窄栏中的英文授权按钮需要换行，否则会被卡片裁切。
  const buttonClass = "h-auto min-h-7 max-w-full whitespace-normal py-1";
  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="device-bridge-settings"
      aria-busy={busy || !state}
    >
      <p className="text-ui-sm leading-5 text-foreground-subtle">{t("description")}</p>
      <SettingsGroupCard>
        <SettingsRow
          label={t("account")}
          description={t(status)}
          controlLayout="wide"
          control={
            <div className="flex flex-wrap gap-2">
              {active ? (
                <>
                  {state?.canLogin ? (
                    <Button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => void run({ action: "open-login" })}
                      data-testid="device-bridge-login"
                    >
                      {t("login")}
                    </Button>
                  ) : null}
                  <Button
                    className={buttonClass}
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "stop" })}
                    data-testid="device-bridge-stop"
                  >
                    {t("stop")}
                  </Button>
                  {authorized ? (
                    <Button
                      className={buttonClass}
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run({ action: "logout" })}
                      data-testid="device-bridge-logout"
                    >
                      {t("logout")}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  className={buttonClass}
                  disabled={busy || !state}
                  onClick={() => void run({ action: "start" })}
                  data-testid="device-bridge-start"
                >
                  {t("start")}
                </Button>
              )}
            </div>
          }
        />
        {authorized ? (
          <div className="space-y-1 border-t border-border px-4 py-3 text-ui-sm">
            <p className="break-all" data-testid="device-bridge-account">
              {state?.loginName || state?.tailnet}
            </p>
            <p className="break-all text-foreground-subtle">
              {t("thisComputer")}: {state?.dnsName}
            </p>
          </div>
        ) : null}
      </SettingsGroupCard>
      <SettingsGroupCard>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-ui-base font-medium">{t("devices")}</h3>
            <p className="text-ui-sm leading-5 text-foreground-subtle">{t("addDescription")}</p>
          </div>
          <Button
            className={buttonClass}
            variant="outline"
            disabled={busy || !state}
            onClick={() => void run({ action: "refresh" })}
            data-testid="device-bridge-refresh"
          >
            <RefreshCw className="size-4" />
            {t("refresh")}
          </Button>
        </div>
        {!state?.peers.length ? (
          <p
            className="border-t border-border p-4 text-ui-sm text-foreground-subtle"
            data-testid="device-bridge-empty"
          >
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {state.peers.map((peer) => (
              <li
                key={peer.nodeId}
                className="min-w-0 space-y-3 p-4"
                data-testid={`device-bridge-peer-${peer.nodeId}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Network className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <div className="min-w-0 space-y-1">
                    <h4 className="break-all text-ui-base font-medium">{peer.name}</h4>
                    <p className="text-ui-sm text-foreground-subtle">
                      {peer.os} · {t(peer.online ? "online" : "offline")} ·{" "}
                      {t(peer.connected ? "enabled" : "notConnected")}
                    </p>
                    {peer.checkedAt && peer.toolCount !== undefined ? (
                      <p
                        className="text-ui-sm text-foreground-subtle"
                        data-testid="device-bridge-check-result"
                      >
                        {t("checked", { count: peer.toolCount })}
                      </p>
                    ) : null}
                    {peer.allowed ? (
                      <p className="text-ui-sm text-foreground-subtle">{t("allowed")}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={buttonClass}
                    variant="outline"
                    disabled={busy || !authorized || (!peer.online && !peer.connected)}
                    onClick={() =>
                      void run({
                        action: peer.connected ? "disconnect" : "connect",
                        nodeId: peer.nodeId,
                      })
                    }
                    data-testid={`device-bridge-connect-${peer.nodeId}`}
                  >
                    {t(peer.connected ? "disconnect" : "connect")}
                  </Button>
                  {peer.connected ? (
                    <Button
                      className={buttonClass}
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run({ action: "check", nodeId: peer.nodeId })}
                      data-testid={`device-bridge-check-${peer.nodeId}`}
                    >
                      {t("check")}
                    </Button>
                  ) : null}
                  <Button
                    className={buttonClass}
                    variant="outline"
                    disabled={busy || !authorized}
                    onClick={() =>
                      void run({ action: "authorize", nodeId: peer.nodeId, allowed: !peer.allowed })
                    }
                    data-testid={`device-bridge-authorize-${peer.nodeId}`}
                  >
                    {t(peer.allowed ? "revoke" : "authorize")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroupCard>
      <SettingsGroupCard>
        <SettingsRow
          label={t("component")}
          description={t("componentDescription")}
          controlLayout="wide"
          control={
            <Button
              className={buttonClass}
              variant="outline"
              disabled={busy || active || !state}
              onClick={() => void selectComponent()}
              data-testid="device-bridge-select-component"
            >
              {t("selectComponent")}
            </Button>
          }
        />
        {state?.binaryPath ? (
          <p className="break-all border-t border-border px-4 py-3 font-mono text-ui-sm text-foreground-subtle">
            {state.binaryPath}
          </p>
        ) : null}
      </SettingsGroupCard>
      <p className="text-ui-sm leading-5 text-foreground-subtle">{t("lifecycle")}</p>
      {busy ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {t("working")}
        </p>
      ) : null}
      {error || state?.error ? (
        <p role="alert" className="text-ui-sm text-destructive" data-testid="device-bridge-error">
          {t(getDeviceBridgeErrorCode(state?.error ?? error))}
        </p>
      ) : null}
    </section>
  );
}
