import { DeviceInspectionDialog } from "./DeviceInspectionDialog.js";
import { DeviceBridgePeerStatus } from "./DeviceBridgePeerStatus.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { DeviceNodeEnrollment } from "./DeviceNodeEnrollment.js";
import { Network, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getDeviceBridgeErrorCode } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useDeviceBridgeSettings } from "@/hooks/useDeviceBridgeSettings.js";
import { SettingsGroupCard, SettingsRow } from "./SettingsPageParts.js";

export function DeviceBridgeSettingsSection() {
  const { intl } = useZCodeIntl();
  const { state, busy, error, run, selectComponent, openManagementKeys } =
    useDeviceBridgeSettings();
  const confirm = useConfirmDialog();
  const platform = usePlatform();
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);
  const inspectedPeer =
    state?.phase === "running" && state.backendState === "Running"
      ? state.peers.find(
          (p) => p.nodeId === inspectedNode && p.online && p.connected && p.checkedAt,
        )
      : undefined;
  useEffect(() => {
    if (inspectedNode && !inspectedPeer) setInspectedNode(null);
  }, [inspectedNode, inspectedPeer]);
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    setApiKey("");
  }, [state?.nodeId, state?.loginName, state?.tailnet]);
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
      <DeviceNodeEnrollment busy={busy || !state} run={run} />
      <div className="space-y-4" data-testid="device-bridge-network">
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
              <p
                className="select-text break-all text-foreground-subtle"
                data-testid="device-bridge-node-id"
              >
                {t("nodeId")}: {state?.nodeId}
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
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <h4 className="min-w-0 flex-1 break-all text-ui-base font-medium">
                          {peer.name}
                        </h4>
                        <DeviceBridgePeerStatus
                          peer={peer}
                          networkReady={state.phase === "running" && authorized}
                        />
                      </div>
                      <p className="text-ui-sm text-foreground-subtle">{peer.os}</p>
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
                    {platform.inspectDeviceBridge && peer.connected ? (
                      <Button
                        className={buttonClass}
                        variant="outline"
                        disabled={busy || !authorized || !peer.online || !peer.checkedAt}
                        onClick={() => setInspectedNode(peer.nodeId)}
                        data-testid={`device-bridge-inspect-${peer.nodeId}`}
                      >
                        {t("inspect.open")}
                      </Button>
                    ) : null}
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
                      disabled={busy || !authorized || !state.managementConfigured}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("removeTitle"),
                            description: t("removeDescription", {
                              name: peer.name,
                              id: peer.nodeId,
                            }),
                            confirmLabel: t("remove"),
                            confirmVariant: "destructive",
                            showKeyboardHints: false,
                          })
                        )
                          await run({ action: "remove", nodeId: peer.nodeId });
                      }}
                      data-testid={`device-bridge-remove-${peer.nodeId}`}
                    >
                      {t("remove")}
                    </Button>
                    <Button
                      className={buttonClass}
                      variant="outline"
                      disabled={busy || !authorized}
                      onClick={() =>
                        void run({
                          action: "authorize",
                          nodeId: peer.nodeId,
                          allowed: !peer.allowed,
                        })
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
            label={t("management")}
            description={t("managementDescription")}
            controlLayout="wide"
            control={
              <div className="w-full min-w-0 space-y-2">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  aria-label={t("managementKey")}
                  placeholder={t("managementKey")}
                  disabled={busy || !state}
                  data-testid="device-bridge-management-key"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={buttonClass}
                    variant="outline"
                    onClick={openManagementKeys}
                    data-testid="device-bridge-management-get-key"
                  >
                    {t("managementGetKey")}
                  </Button>
                  <Button
                    className={buttonClass}
                    variant="outline"
                    disabled={busy || !authorized || !/^[A-Za-z0-9_-]+$/.test(apiKey.trim())}
                    onClick={() => {
                      // 草稿提交即清空；Main 加密保存，只返回配置状态，不回填密钥。
                      const value = apiKey.trim();
                      setApiKey("");
                      void run({ action: "configure-management", apiKey: value });
                    }}
                    data-testid="device-bridge-management-save"
                  >
                    {t("managementSave")}
                  </Button>
                  <Button
                    className={buttonClass}
                    variant="outline"
                    disabled={busy || !state}
                    onClick={() => {
                      setApiKey("");
                      void run({ action: "clear-management" });
                    }}
                    data-testid="device-bridge-management-clear"
                  >
                    {t("managementClear")}
                  </Button>
                </div>
                <p className="text-ui-sm text-foreground-subtle" role="status">
                  {t(
                    state?.managementStorageError
                      ? "device_bridge_management_storage_unavailable"
                      : state?.managementConfigured
                        ? "managementConfigured"
                        : !authorized
                          ? "managementConnectFirst"
                          : "managementMissing",
                  )}
                </p>
              </div>
            }
          />
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
      </div>
      {inspectedPeer ? (
        <DeviceInspectionDialog
          key={inspectedPeer.nodeId}
          nodeId={inspectedPeer.nodeId}
          name={inspectedPeer.name}
          onClose={() => setInspectedNode(null)}
        />
      ) : null}
      {busy ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {t("working")}
        </p>
      ) : null}
      {error || state?.error ? (
        <p role="alert" className="text-ui-sm text-destructive" data-testid="device-bridge-error">
          {t(getDeviceBridgeErrorCode(error ?? state?.error))}
        </p>
      ) : null}
    </section>
  );
}
