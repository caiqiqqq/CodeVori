import { useEffect, useState } from "react";
import type { DesktopLanAccessState } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function DesktopLanAccessSection() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<DesktopLanAccessState>({ enabled: false, urls: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void platform
      .getDesktopLanAccess?.()
      .then((value) => {
        if (live) setState(value);
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
  if (!platform.getDesktopLanAccess || !platform.setDesktopLanAccessEnabled) return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await platform.setDesktopLanAccessEnabled!(!state.enabled));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
              disabled={busy}
              onClick={() => void toggle()}
              data-testid="desktop-lan-toggle"
            >
              {intl.formatMessage({
                id: state.enabled ? "settings.desktopLan.stop" : "settings.desktopLan.start",
              })}
            </Button>
          }
        />
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
              {state.urls.map((url, index) => (
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
