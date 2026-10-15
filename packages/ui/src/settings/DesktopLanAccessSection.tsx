import { useEffect, useState } from "react";
import type { DesktopLanAccessState } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";

export function DesktopLanAccessSection() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<DesktopLanAccessState>({ enabled: false, urls: [] });
  const [busy, setBusy] = useState(false);
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
      });
    return () => {
      live = false;
    };
  }, [platform]);
  if (!platform.setDesktopLanAccessEnabled) return null;
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
    <section className="space-y-3" data-testid="desktop-lan-access">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-ui-base font-medium">
            {intl.formatMessage({ id: "settings.desktopLan.title" })}
          </h3>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.desktopLan.description" })}
          </p>
        </div>
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
      </div>
      {state.enabled ? (
        <div className="space-y-2">
          {state.urls.map((url) => (
            <div key={url} className="space-y-1">
              <label className="text-ui-sm" htmlFor={`lan-${url}`}>
                {intl.formatMessage({ id: "settings.desktopLan.link" })}
              </label>
              <Input
                id={`lan-${url}`}
                readOnly
                value={`${url}/?token=${encodeURIComponent(state.token ?? "")}`}
                onFocus={(event) => event.target.select()}
              />
            </div>
          ))}
          <label className="block text-ui-sm">
            {intl.formatMessage({ id: "settings.desktopLan.token" })}
            <Input
              type="password"
              readOnly
              value={state.token ?? ""}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.desktopLan.hint" })}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
