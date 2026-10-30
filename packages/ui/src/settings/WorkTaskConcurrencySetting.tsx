import { useEffect, useId, useState } from "react";
import { DEFAULT_WORK_TASK_CONCURRENCY, workTaskExecutionConcurrencySchema } from "@zcode/shared";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

export function WorkTaskConcurrencySetting() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saved = settings?.workTaskConcurrency ?? DEFAULT_WORK_TASK_CONCURRENCY;
  const [draft, setDraft] = useState(String(saved));
  const errorId = useId();
  useEffect(() => {
    setDraft(String(saved));
    setSaveError(false);
  }, [saved]);
  const parsed = workTaskExecutionConcurrencySchema.safeParse(Number(draft));
  const invalid = !parsed.success;
  const dirty = parsed.success && parsed.data !== saved;
  const label = intl.formatMessage({ id: "settings.workTaskConcurrency" });
  const save = async () => {
    if (!parsed.success || !dirty || saving || !settings) return;
    setSaving(true);
    setSaveError(false);
    try {
      // 输入框仅保存草稿；显式保存后更新所属 Host，不能把未确认的数值直接用于调度。
      await update({ workTaskConcurrency: parsed.data });
    } catch (error) {
      logger.warn("[settings] 保存待办任务并发上限失败", { error: String(error) });
      setSaveError(true);
      toast(intl.formatMessage({ id: "settings.workTaskConcurrencySaveError" }));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsRow
      label={label}
      controlLayout="compact"
      description={intl.formatMessage({ id: "settings.workTaskConcurrencyDescription" })}
      detail={
        <div className="space-y-2">
          <Input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            size="lg"
            value={draft}
            disabled={!settings || saving}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={invalid || saveError ? errorId : undefined}
            className="w-full max-w-64 text-mobile-input-safe sm:text-ui-base"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setSaveError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
          {(invalid || saveError) && (
            <span id={errorId} role="alert" className="text-ui-caption text-destructive">
              {intl.formatMessage({
                id: invalid
                  ? "settings.workTaskConcurrencyInvalid"
                  : "settings.workTaskConcurrencySaveError",
              })}
            </span>
          )}
        </div>
      }
      control={
        <Button
          type="button"
          size="lg"
          aria-label={intl.formatMessage({ id: "settings.workTaskConcurrencySave" })}
          disabled={!settings || saving || invalid || !dirty}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
        </Button>
      }
    />
  );
}
