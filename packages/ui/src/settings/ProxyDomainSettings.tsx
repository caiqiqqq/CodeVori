import { useEffect, useState } from "react";
import { normalizeProxyOnlyDomains } from "@zcode/shared";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProxyDomainSettings({
  value,
  onSave,
}: {
  value: string;
  onSave(value: string): Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDraft(value);
    setFailed(false);
  }, [value]);
  let normalized = "",
    invalid = false;
  try {
    normalized = normalizeProxyOnlyDomains(draft) ?? "";
  } catch {
    invalid = true;
  }
  const dirty = normalized !== value;
  const save = async () => {
    if (saving || invalid || !dirty) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave(normalized);
      setDraft(normalized);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const label = intl.formatMessage({ id: "settings.httpProxyOnlyDomains" });
  return (
    <SettingsRow
      controlLayout="compact"
      label={label}
      description={intl.formatMessage({ id: "settings.httpProxyOnlyDomainsDescription" })}
      control={
        <Button
          type="button"
          size="lg"
          disabled={saving || invalid || !dirty}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
        </Button>
      }
      detail={
        <div className="space-y-2">
          <Input
            size="lg"
            value={draft}
            disabled={saving}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={invalid || failed ? "proxy-domains-error" : undefined}
            placeholder={intl.formatMessage({ id: "settings.httpProxyOnlyDomainsPlaceholder" })}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setFailed(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            className="max-w-[520px] font-mono text-mobile-input-safe sm:text-ui-base"
          />
          {(invalid || failed) && (
            <p id="proxy-domains-error" role="alert" className="text-ui-sm text-destructive">
              {intl.formatMessage({
                id: invalid
                  ? "settings.httpProxyOnlyDomainsInvalid"
                  : "settings.httpProxyOnlyDomainsSaveFailed",
              })}
            </p>
          )}
        </div>
      }
    />
  );
}
