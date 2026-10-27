import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import type { EmbeddedBrowserSitePermissionsSnapshot } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { sitePermissionLabel } from "@/browser-use/EmbeddedBrowserSitePermissionPrompt.js";

export function BrowserSitePermissions() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [snapshot, setSnapshot] = useState<EmbeddedBrowserSitePermissionsSnapshot>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const requestVersion = useRef(0);
  const mutationPending = useRef(false);
  const reload = useCallback(async () => {
    if (!platform.getEmbeddedBrowserSitePermissions || mutationPending.current) return;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const next = await platform.getEmbeddedBrowserSitePermissions();
      if (requestVersion.current !== version) return;
      setSnapshot(next);
      setError(false);
    } catch (cause) {
      logger.warn("[browser-site-permissions] 读取失败", { cause });
      if (requestVersion.current === version) setError(true);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [platform]);
  useEffect(() => {
    void reload();
    // 站点权限由 Main 共享；返回本窗口时重新读取，不能把旧快照当作有效授权。
    const onFocus = () => {
      void reload();
    };
    window.addEventListener("focus", onFocus);
    const dispose = platform.onEmbeddedBrowserSitePermissionsChanged?.(() => {
      void reload();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      dispose?.();
      requestVersion.current += 1;
    };
  }, [platform, reload]);

  const change = async (operation: () => Promise<EmbeddedBrowserSitePermissionsSnapshot>) => {
    requestVersion.current += 1;
    mutationPending.current = true;
    setLoading(false);
    setPending(true);
    try {
      setSnapshot(await operation());
      setError(false);
    } catch (cause) {
      logger.warn("[browser-site-permissions] 更新失败", { cause });
      setError(true);
    } finally {
      mutationPending.current = false;
      setPending(false);
    }
  };
  const origins = Object.keys(snapshot).sort();
  if (
    !platform.getEmbeddedBrowserSitePermissions ||
    !platform.setEmbeddedBrowserSitePermission ||
    !platform.resetEmbeddedBrowserSitePermission ||
    !platform.clearEmbeddedBrowserSitePermissions
  )
    return null;

  return (
    <section className="space-y-3" data-testid="browser-site-permissions">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ui-base font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "browser.sitePermission.settingsTitle" })}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || loading || !origins.length}
          title={intl.formatMessage({ id: "browser.sitePermission.clearAll" })}
          onClick={() => void change(() => platform.clearEmbeddedBrowserSitePermissions!())}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: "browser.sitePermission.clearAll" })}
        </Button>
      </div>
      {loading ? (
        <LoaderCircle
          className="size-4 animate-spin"
          aria-label={intl.formatMessage({ id: "common.loading" })}
        />
      ) : null}
      {error ? (
        <div className="flex items-center gap-2 text-ui-base text-destructive">
          {intl.formatMessage({ id: "browser.sitePermission.error" })}
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            <RotateCcw className="size-4" />
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : null}
      {!loading && !error && !origins.length ? (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "browser.sitePermission.empty" })}
        </p>
      ) : null}
      {origins.map((origin) => (
        <div key={origin} className="border-t border-border py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="min-w-0 break-all text-ui-base font-medium">{origin}</h4>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              title={intl.formatMessage({ id: "browser.sitePermission.resetSite" })}
              aria-label={`${intl.formatMessage({ id: "browser.sitePermission.resetSite" })}: ${origin}`}
              onClick={() =>
                void change(() => platform.resetEmbeddedBrowserSitePermission!(origin))
              }
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
          {Object.entries(snapshot[origin] ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([permission, state]) => (
              <label
                key={permission}
                className="flex items-center justify-between gap-3 py-1 text-ui-base"
              >
                <span>{intl.formatMessage({ id: sitePermissionLabel(permission) })}</span>
                <select
                  value={state}
                  disabled={pending}
                  className="max-w-36 rounded border border-input-border bg-input px-2 py-1 text-ui-base"
                  onChange={(event) =>
                    void change(() =>
                      platform.setEmbeddedBrowserSitePermission!({
                        origin,
                        permission,
                        state: event.target.value as "allow" | "deny" | "ask",
                      }),
                    )
                  }
                >
                  <option value="allow">
                    {intl.formatMessage({ id: "browser.sitePermission.allowed" })}
                  </option>
                  <option value="deny">
                    {intl.formatMessage({ id: "browser.sitePermission.blocked" })}
                  </option>
                  <option value="ask">
                    {intl.formatMessage({ id: "browser.sitePermission.ask" })}
                  </option>
                </select>
              </label>
            ))}
        </div>
      ))}
    </section>
  );
}
