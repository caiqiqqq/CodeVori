import { useEffect, useRef, useState } from "react";
import { desktopLanAccessConfigurationSchema, type DesktopLanAccessState } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { DesktopLanQrCode } from "@/settings/DesktopLanQrCode.js";

export function DesktopLanAccessSection() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<DesktopLanAccessState>({ enabled: false, urls: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("3030");
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let live = true;
    void platform
      .getDesktopLanAccess?.()
      .then((value) => {
        if (live) {
          setState(value);
          setAddress(value.configuration?.address ?? "");
          setPort(String(value.configuration?.port ?? 3030));
        }
      })
      .catch((error) => {
        if (live) setError(String(error));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [platform]);
  if (
    !platform.getDesktopLanAccess ||
    !platform.setDesktopLanAccessEnabled ||
    !platform.saveDesktopLanAccessConfiguration
  )
    return null;
  const parsed = desktopLanAccessConfigurationSchema.safeParse({
    address,
    port: /^\d+$/.test(port) ? Number(port) : NaN,
  });
  const dirty =
    !parsed.success ||
    parsed.data.address !== state.configuration?.address ||
    parsed.data.port !== state.configuration?.port;
  const run = async (operation: () => Promise<DesktopLanAccessState>, saving = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await operation();
      setState(next);
      if (saving && next.configuration) {
        setAddress(next.configuration.address);
        setPort(String(next.configuration.port));
        setSaved(true);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      // 关闭时即使偏好保存失败，Main 仍会停止监听；失败后重新读取事实，避免页面继续显示已开启。
      const actual = await platform.getDesktopLanAccess!().catch(() => undefined);
      if (actual) setState(actual);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const save = () => {
    if (!parsed.success) {
      setError(intl.formatMessage({ id: "settings.desktopLan.invalidConfiguration" }));
      return;
    }
    void run(() => platform.saveDesktopLanAccessConfiguration!(parsed.data), true);
  };
  return (
    <section className="min-w-0 space-y-4" data-testid="desktop-lan-access" aria-busy={busy}>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({
            id: state.enabled ? "settings.desktopLan.enabled" : "settings.desktopLan.disabled",
          })}
          description={intl.formatMessage({ id: "settings.desktopLan.description" })}
          controlLayout="wide"
          control={
            <Button
              variant="outline"
              disabled={busy || (!state.enabled && (!state.configuration || dirty))}
              onClick={() => void run(() => platform.setDesktopLanAccessEnabled!(!state.enabled))}
              data-testid="desktop-lan-toggle"
            >
              {intl.formatMessage({
                id: state.enabled ? "settings.desktopLan.stop" : "settings.desktopLan.start",
              })}
            </Button>
          }
        />
      </SettingsGroupCard>
      <SettingsGroupCard>
        <div className="min-w-0 space-y-4 p-4">
          <p className="text-ui-sm leading-5 text-foreground-subtle">
            {intl.formatMessage({
              id: state.enabled
                ? "settings.desktopLan.configurationLocked"
                : "settings.desktopLan.configurationDescription",
            })}
          </p>
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_9rem]">
            <div className="min-w-0 space-y-2">
              <label htmlFor="desktop-lan-address" className="text-ui-base font-medium">
                {intl.formatMessage({ id: "settings.desktopLan.address" })}
              </label>
              <Input
                id="desktop-lan-address"
                data-testid="desktop-lan-address"
                className="font-mono text-mobile-input-safe md:text-ui-base"
                value={address}
                disabled={busy || state.enabled}
                placeholder="192.168.1.100"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <label htmlFor="desktop-lan-port" className="text-ui-base font-medium">
                {intl.formatMessage({ id: "settings.desktopLan.port" })}
              </label>
              <Input
                id="desktop-lan-port"
                data-testid="desktop-lan-port"
                className="font-mono text-mobile-input-safe md:text-ui-base"
                value={port}
                inputMode="numeric"
                disabled={busy || state.enabled}
                onChange={(event) => {
                  setPort(event.target.value);
                  setSaved(false);
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              data-testid="desktop-lan-save"
              disabled={busy || state.enabled || !dirty}
              onClick={save}
            >
              {intl.formatMessage({ id: "settings.desktopLan.save" })}
            </Button>
            {saved ? (
              <p role="status" className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "settings.desktopLan.saved" })}
              </p>
            ) : null}
          </div>
        </div>
      </SettingsGroupCard>
      {state.enabled ? (
        <>
          {/* 分组卡片默认没有内边距；独立内容显式留白并限制长链接，避免贴边或撑开窄屏。 */}
          <SettingsGroupCard>
            <div className="min-w-0 space-y-4 p-4">
              <div className="space-y-1">
                <h3 className="text-ui-base font-medium">
                  {intl.formatMessage({ id: "settings.desktopLan.link" })}
                </h3>
                <p className="text-ui-sm leading-5 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.desktopLan.linkDescription" })}
                </p>
              </div>
              {state.urls.slice(0, 1).map((url, index) => (
                <div key={url} className="min-w-0 space-y-2">
                  <label
                    className="block break-all text-ui-sm text-foreground-subtle"
                    htmlFor={`desktop-lan-url-${index}`}
                  >
                    {url}
                  </label>
                  <Input
                    id={`desktop-lan-url-${index}`}
                    size="lg"
                    className="font-mono"
                    readOnly
                    value={`${url}/?token=${encodeURIComponent(state.token ?? "")}`}
                    onFocus={(event) => event.target.select()}
                  />
                  {state.token ? (
                    // 凭据变化即重建，异步生成期间也不能继续显示上一份 Token 的二维码。
                    <DesktopLanQrCode
                      key={`${url}:${state.token}`}
                      value={`${url}/?token=${encodeURIComponent(state.token)}`}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </SettingsGroupCard>
          <SettingsGroupCard>
            <div className="min-w-0 space-y-3 p-4">
              <div className="space-y-1">
                <label htmlFor="desktop-lan-token" className="text-ui-base font-medium">
                  {intl.formatMessage({ id: "settings.desktopLan.token" })}
                </label>
                <p className="text-ui-sm leading-5 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.desktopLan.tokenDescription" })}
                </p>
              </div>
              <Input
                id="desktop-lan-token"
                size="lg"
                className="font-mono"
                type="password"
                readOnly
                value={state.token ?? ""}
                onFocus={(event) => event.target.select()}
              />
            </div>
          </SettingsGroupCard>
        </>
      ) : null}
      <p className="text-ui-sm leading-5 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.desktopLan.hint" })}
      </p>
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
