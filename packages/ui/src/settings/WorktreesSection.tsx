import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { normalizeConfiguredWorktreeRoot, resolveDefaultWorktreeRoot } from "@/lib/worktree.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { logger } from "@/logger.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function WorktreesSection({ defaultHomeDir }: { defaultHomeDir: string }) {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const defaultRoot = useMemo(
    () => (defaultHomeDir.trim() ? resolveDefaultWorktreeRoot(defaultHomeDir) : ""),
    [defaultHomeDir],
  );
  const configuredRoot = settings?.worktreeRootDirectory?.trim() ?? "";
  const effectiveRoot = configuredRoot || defaultRoot;
  const [draftRoot, setDraftRoot] = useState(effectiveRoot);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingDraftRootRef = useRef<string | null>(null);
  const persistedRootRef = useRef(configuredRoot);

  useEffect(() => {
    setDraftRoot(effectiveRoot);
  }, [effectiveRoot]);

  useEffect(() => {
    if (!savingRef.current) {
      persistedRootRef.current = configuredRoot;
    }
  }, [configuredRoot]);

  const save = useCallback(
    async (nextDraftRoot = draftRoot) => {
      pendingDraftRootRef.current = nextDraftRoot;
      if (savingRef.current) {
        return;
      }

      savingRef.current = true;
      setSaving(true);
      try {
        while (pendingDraftRootRef.current !== null) {
          const requestedRoot = pendingDraftRootRef.current;
          pendingDraftRootRef.current = null;
          const nextConfiguredRoot = normalizeConfiguredWorktreeRoot(requestedRoot, defaultRoot);
          const nextPersistedRoot = nextConfiguredRoot ?? "";
          if (nextPersistedRoot !== persistedRootRef.current) {
            // 默认目录不必重复落盘；删除配置后仍由本机 home 派生，换用户目录也能自然迁移。
            await update({ worktreeRootDirectory: nextConfiguredRoot });
            persistedRootRef.current = nextPersistedRoot;
          }

          // 清空默认值不会触发设置变更通知，失焦后仍需把输入框还原为实际生效路径。
          if (!nextConfiguredRoot && pendingDraftRootRef.current === null) {
            setDraftRoot(defaultRoot);
          }
        }
      } catch (error: unknown) {
        pendingDraftRootRef.current = null;
        logger.warn("[WorktreesSection] 自动保存工作树目录失败", {
          error: getErrorMessage(error),
        });
        toast(intl.formatMessage({ id: "settings.worktrees.saveFailed" }));
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [defaultRoot, draftRoot, intl, update],
  );

  const inputDisabled = saving || (!defaultRoot && !configuredRoot);

  return (
    <div className="space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.worktrees.directory" })}
          description={
            <p className="text-ui-sm leading-5">
              {intl.formatMessage({ id: "settings.worktrees.directoryDescription" })}
            </p>
          }
          controlLayout="balanced"
          control={
            <Input
              size="lg"
              value={draftRoot}
              disabled={inputDisabled}
              placeholder={intl.formatMessage({ id: "settings.worktrees.directoryPlaceholder" })}
              aria-label={intl.formatMessage({ id: "settings.worktrees.directory" })}
              aria-busy={saving}
              className="h-9 min-w-0 bg-input font-mono text-ui-base"
              onChange={(event) => setDraftRoot(event.target.value)}
              onBlur={() => void save()}
            />
          }
        />
      </SettingsGroupCard>
    </div>
  );
}
