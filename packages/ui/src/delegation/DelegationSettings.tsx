import { useState } from "react";
import { Gauge, HardDrive, Layers, Power } from "lucide-react";
import { useDelegationSettings } from "@/hooks/useDelegationSettings.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

export function DelegationSettings({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
}: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}) {
  const { settings, update, error } = useDelegationSettings(
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
  );
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const [concurrency, setConcurrency] = useState<string | null>(null);
  const [depth, setDepth] = useState<string | null>(null);
  const [cache, setCache] = useState<string | null>(null);
  if (!settings) return null;
  return (
    <section className="space-y-4 text-ui-base" data-testid="delegation-settings">
      <p className="text-ui-base leading-6 text-foreground-subtle">{t("settingsDescription")}</p>
      <div className="border-y border-border">
        <SettingsRow
          controlLayout="compact"
          label={
            <label htmlFor="delegation-enabled" className="flex items-center gap-2">
              <Power className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
              {t("enabled")}
            </label>
          }
          detail={
            <p className="text-ui-sm leading-5 text-foreground-subtle">{t("enabledDescription")}</p>
          }
          control={
            <Switch
              id="delegation-enabled"
              checked={settings.enabled}
              onCheckedChange={(enabled) => void update({ enabled })}
            />
          }
        />
        <SettingsRow
          controlLayout="compact"
          label={
            <label htmlFor="delegation-depth" className="flex items-center gap-2">
              <Gauge className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
              {t("maxDepth")}
            </label>
          }
          detail={
            <p className="text-ui-sm leading-5 text-foreground-subtle">{t("depthDescription")}</p>
          }
          control={
            <Input
              id="delegation-depth"
              size="lg"
              className="w-24"
              type="number"
              min={1}
              max={8}
              step={1}
              disabled={!settings.enabled}
              value={depth ?? String(settings.allowNested ? settings.maxDepth : 1)}
              onChange={(e) => setDepth(e.target.value)}
              onBlur={() => {
                if (depth === null) return;
                const value = Number(depth);
                setDepth(null);
                if (Number.isInteger(value) && value >= 1 && value <= 8)
                  void update({ maxDepth: value });
              }}
            />
          }
        />
        <SettingsRow
          controlLayout="compact"
          label={
            <label htmlFor="delegation-cache-mb" className="flex items-center gap-2">
              <HardDrive className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
              {t("completedCache")}
            </label>
          }
          detail={
            <p className="text-ui-sm leading-5 text-foreground-subtle">{t("cacheDescription")}</p>
          }
          control={
            <Input
              id="delegation-cache-mb"
              size="lg"
              className="w-24"
              type="number"
              min={0}
              max={4_294_967_295}
              step={1}
              disabled={!settings.enabled}
              value={cache ?? String(settings.completedCacheMaxMb)}
              onChange={(e) => setCache(e.target.value)}
              onBlur={() => {
                if (cache === null) return;
                const value = cache.trim() === "" ? NaN : Number(cache);
                setCache(null);
                // 清空输入不能被 Number("") 当作 0，否则会意外把缓存改成不限额。
                if (Number.isInteger(value) && value >= 0 && value <= 4_294_967_295)
                  void update({ completedCacheMaxMb: value });
              }}
            />
          }
        />
        <SettingsRow
          controlLayout="compact"
          label={
            <label htmlFor="delegation-concurrency" className="flex items-center gap-2">
              <Layers className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
              {t("concurrency")}
            </label>
          }
          detail={
            <p className="text-ui-sm leading-5 text-foreground-subtle">
              {t("concurrencyDescription")}
            </p>
          }
          control={
            <Input
              id="delegation-concurrency"
              size="lg"
              className="w-24"
              type="number"
              min={1}
              max={8}
              step={1}
              disabled={!settings.enabled}
              value={concurrency ?? String(settings.concurrency)}
              onChange={(e) => setConcurrency(e.target.value)}
              onBlur={() => {
                if (concurrency === null) return;
                const value = Number(concurrency);
                setConcurrency(null);
                if (Number.isInteger(value) && value >= 1 && value <= 8)
                  void update({ concurrency: value });
              }}
            />
          }
        />
      </div>
      {error ? (
        <p role="alert" className="break-words text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
