import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitAccountAddRequest,
  GitAccountRotateRequest,
  GitDetection,
  GitVersionControlSettings,
} from "@zcode/shared";
import { useServices } from "./useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";
import { logger } from "@/logger.js";

const emptySettings: GitVersionControlSettings = { customPath: null, accounts: [] };

export function useVersionControlSettings() {
  const { gitService } = useServices();
  const { intl } = useZCodeIntl();
  const [settings, setSettings] = useState(emptySettings);
  const [detection, setDetection] = useState<GitDetection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const admitted = useRef(false);
  const available = typeof gitService?.getVersionControlSettings === "function";

  const refresh = useCallback(async () => {
    if (admitted.current) return;
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      if (!available) throw new Error("VERSION_CONTROL_UNAVAILABLE");
      const [snapshot, git] = await Promise.all([
        gitService.getVersionControlSettings(),
        gitService.detectGit(),
      ]);
      if (generation.current === current) {
        setSettings(snapshot);
        setDetection(git);
      }
    } catch {
      if (generation.current === current) setError("loadFailed");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [available, gitService]);

  useEffect(() => {
    admitted.current = false;
    setBusy(false);
    setSettings(emptySettings);
    setDetection(null);
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (admitted.current || loading || !available) return false;
      admitted.current = true;
      const current = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        await operation();
        if (generation.current !== current) return false;
        return true;
      } catch (failure) {
        if (generation.current === current) {
          const message = failure instanceof Error ? failure.message : "";
          setError(
            message.includes("INVALID_GIT_PATH")
              ? "invalidPath"
              : message.includes("INVALID_SERVER_URL")
                ? "invalidServer"
                : message.includes("identity-changed")
                  ? "identityChanged"
                  : message.includes("VERSION_CONTROL_authentication")
                    ? "testError.authentication"
                    : message.includes("VERSION_CONTROL_forbidden")
                      ? "testError.forbidden"
                      : message.includes("VERSION_CONTROL_network")
                        ? "testError.network"
                        : "operationFailed",
          );
          logger.warn("[VersionControlSettings] 版本控制操作失败");
        }
        return false;
      } finally {
        // Host 已切换时旧请求不能解锁新 Host 正在执行的操作。
        if (generation.current === current) {
          admitted.current = false;
          setBusy(false);
        }
      }
    },
    [available, loading],
  );

  const mutate = useCallback(
    (operation: () => Promise<GitVersionControlSettings>) => {
      const current = generation.current + 1;
      return run(async () => {
        const next = await operation();
        if (generation.current === current) setSettings(next);
      });
    },
    [run],
  );

  const savePath = useCallback(
    (path: string) => {
      const current = generation.current + 1;
      return run(async () => {
        const git = await gitService.updateGitPath({ path });
        if (generation.current === current) {
          setSettings((previous) => ({ ...previous, customPath: path.trim() || null }));
          setDetection(git);
        }
      });
    },
    [gitService, run],
  );
  const testAccount = useCallback(
    (accountId: string) => {
      const current = generation.current + 1;
      return run(async () => {
        const result = await gitService.testGitAccount({ accountId });
        if (generation.current !== current) return;
        const key = result.success
          ? result.kind === "stored"
            ? "credentialAvailable"
            : "connectionSuccess"
          : `testError.${result.error ?? "response"}`;
        toast(intl.formatMessage({ id: `settings.versionControl.${key}` }));
      });
    },
    [gitService, intl, run],
  );

  return {
    owner: gitService,
    settings,
    detection,
    loading,
    busy,
    error,
    available,
    refresh,
    savePath,
    testAccount,
    clearError: () => setError(null),
    addAccount: (request: GitAccountAddRequest) => mutate(() => gitService.addGitAccount(request)),
    rotateAccount: (request: GitAccountRotateRequest) =>
      mutate(() => gitService.rotateGitAccount(request)),
    setDefault: (accountId: string) => mutate(() => gitService.setDefaultGitAccount({ accountId })),
    removeAccount: (accountId: string) => mutate(() => gitService.removeGitAccount({ accountId })),
  };
}
