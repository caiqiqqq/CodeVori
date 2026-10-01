import { useState } from "react";
import type { GitAccount, GitAccountProvider } from "@zcode/shared";
import { Eye, EyeOff, ExternalLink, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { useVersionControlSettings } from "@/hooks/useVersionControlSettings.js";

export const GIT_PROVIDER_DEFAULT_SERVERS: Record<GitAccountProvider, string> = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  gitea: "https://gitea.com",
  git: "",
};

export function VersionControlAccountDialog({
  provider,
  existing,
  management,
  onClose,
}: {
  provider: GitAccountProvider;
  existing?: GitAccount;
  management: ReturnType<typeof useVersionControlSettings>;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const t = (key: string) => intl.formatMessage({ id: `settings.versionControl.${key}` });
  const [serverUrl, setServerUrl] = useState(
    existing?.serverUrl ?? GIT_PROVIDER_DEFAULT_SERVERS[provider],
  );
  const [username, setUsername] = useState(existing?.username ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const canSubmit = Boolean(
    serverUrl.trim() && secret.trim() && (provider !== "git" || username.trim()),
  );
  const submit = async () => {
    if (!canSubmit || management.busy) return;
    const success = existing
      ? await management.rotateAccount({ accountId: existing.id, secret })
      : await management.addAccount({
          provider,
          serverUrl,
          username: provider === "git" ? username : undefined,
          secret,
        });
    if (success) {
      setSecret("");
      onClose();
    }
  };
  const openTokenPage = () => {
    try {
      const base = new URL(serverUrl.includes("://") ? serverUrl : `https://${serverUrl}`);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return;
      const server = base.toString().replace(/\/+$/, "");
      const path =
        provider === "gitlab"
          ? "/-/user_settings/personal_access_tokens?name=ZCode&scopes=api"
          : provider === "gitea"
            ? "/user/settings/applications"
            : "/settings/tokens/new?description=ZCode&scopes=repo,read:org,workflow,read:user,user:email";
      platform.openExternal(`${server}${path}`);
    } catch {
      management.clearError();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !management.busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-md"
        showCloseButton={!management.busy}
      >
        <DialogHeader>
          <DialogTitle>{t(existing ? "updateCredential" : "addAccount")}</DialogTitle>
          <DialogDescription>
            {provider === "git"
              ? t("genericCredential")
              : `${provider === "gitea" ? "Gitea / Forgejo" : provider === "github" ? "GitHub" : "GitLab"} · ${existing?.username ?? t("accessToken")}`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="vc-account-server" className="text-ui-base">
              {t("serverUrl")}
            </label>
            <Input
              id="vc-account-server"
              value={serverUrl}
              onChange={(event) => {
                setServerUrl(event.target.value);
                management.clearError();
              }}
              disabled={Boolean(existing) || management.busy}
              placeholder="https://git.example.com"
              className="w-full font-mono text-mobile-input-safe sm:text-ui-base"
              autoComplete="off"
            />
          </div>
          {provider === "git" ? (
            <div className="space-y-2">
              <label htmlFor="vc-account-user" className="text-ui-base">
                {t("username")}
              </label>
              <Input
                id="vc-account-user"
                value={username}
                disabled={Boolean(existing) || management.busy}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                className="text-mobile-input-safe sm:text-ui-base"
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="vc-account-secret" className="text-ui-base">
                {t(provider === "git" ? "password" : "accessToken")}
              </label>
              {provider !== "git" ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={openTokenPage}
                  disabled={management.busy}
                >
                  <ExternalLink />
                  {t("generateToken")}
                </Button>
              ) : null}
            </div>
            <div className="relative">
              <Input
                id="vc-account-secret"
                type={showSecret ? "text" : "password"}
                value={secret}
                disabled={management.busy}
                onChange={(event) => {
                  setSecret(event.target.value);
                  management.clearError();
                }}
                autoComplete="new-password"
                className="pr-9 text-mobile-input-safe sm:text-ui-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                aria-label={t(showSecret ? "hideSecret" : "showSecret")}
                title={t(showSecret ? "hideSecret" : "showSecret")}
                onClick={() => setShowSecret((previous) => !previous)}
              >
                {showSecret ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            {provider === "gitlab" || provider === "gitea" ? (
              <p className="text-ui-sm text-foreground-subtle">{t(`tokenHint.${provider}`)}</p>
            ) : null}
          </div>
          {management.error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {t(management.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={management.busy}>
              <X />
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={management.busy || !canSubmit}>
              {management.busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t(
                existing
                  ? "updateCredential"
                  : provider === "git"
                    ? "addAccount"
                    : "validateAndAdd",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
