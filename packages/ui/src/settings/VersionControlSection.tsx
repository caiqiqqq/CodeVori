import { useEffect, useState, type ReactNode } from "react";
import type { GitAccount, GitAccountProvider } from "@zcode/shared";
import {
  CheckCircle2,
  XCircle,
  GitBranch,
  GitPullRequest,
  GitMerge,
  GitFork,
  Globe,
  Plus,
  RefreshCw,
  KeyRound,
  Star,
  Trash2,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useVersionControlSettings } from "@/hooks/useVersionControlSettings.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { VersionControlAccountDialog } from "./VersionControlAccountDialog.js";

const PROVIDERS = [
  { id: "github", label: "GitHub", icon: GitPullRequest },
  { id: "gitlab", label: "GitLab", icon: GitMerge },
  { id: "gitea", label: "Gitea / Forgejo", icon: GitFork },
  { id: "git", label: "Git", icon: Globe },
] as const;

function AccountAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VersionControlSection() {
  const management = useVersionControlSettings();
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.versionControl.${key}` });
  const [draftPath, setDraftPath] = useState("");
  const [dialog, setDialog] = useState<{
    provider: GitAccountProvider;
    existing?: GitAccount;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GitAccount | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [pathDirty, setPathDirty] = useState(false);
  const disabled = management.loading || management.busy || !management.available;

  useEffect(() => {
    if (!pathDirty) setDraftPath(management.settings.customPath ?? "");
  }, [management.settings.customPath, pathDirty]);
  useEffect(() => {
    setDialog(null);
    setRemoveTarget(null);
    setTestingId(null);
    setPathDirty(false);
    setDraftPath("");
  }, [management.owner]);

  const testAccount = async (accountId: string) => {
    setTestingId(accountId);
    await management.testAccount(accountId);
    setTestingId((previous) => (previous === accountId ? null : previous));
  };
  const savePath = async () => {
    if (!pathDirty || disabled) return;
    if (await management.savePath(draftPath)) setPathDirty(false);
  };
  const openDialog = (provider: GitAccountProvider, existing?: GitAccount) => {
    management.clearError();
    setDialog({ provider, existing });
  };

  return (
    <div
      className="min-w-0 space-y-6"
      data-testid="version-control-settings"
      aria-busy={management.loading || management.busy}
    >
      <section className="space-y-3" aria-label="Git">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-ui-base font-medium">
            <GitBranch className="size-4 text-foreground-subtle" />
            Git
          </h2>
          <AccountAction
            label={t("refresh")}
            disabled={disabled}
            onClick={() => void management.refresh()}
          >
            <RefreshCw className={management.loading ? "animate-spin" : ""} />
          </AccountAction>
        </div>
        {management.loading ? (
          <div role="status" className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : (
          <div className="space-y-1 text-ui-sm">
            <div className="flex flex-wrap items-center gap-2">
              {management.detection?.installed ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <XCircle className="size-4 text-destructive" />
              )}
              <span>{t(management.detection?.installed ? "gitDetected" : "gitNotFound")}</span>
              <span className="font-mono text-foreground-subtle">
                {management.detection?.version}
              </span>
            </div>
            {management.detection?.path ? (
              <p className="break-all font-mono text-foreground-subtle">
                <span className="font-sans">{t("pathLabel")}</span>{" "}
                <span data-testid="vc-detected-path">{management.detection.path}</span>
              </p>
            ) : null}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="vc-git-path" className="text-ui-base">
            {t("customPath")}
          </label>
          <Input
            id="vc-git-path"
            value={draftPath}
            disabled={disabled}
            placeholder={t("pathPlaceholder")}
            onChange={(event) => {
              setDraftPath(event.target.value);
              setPathDirty(true);
              management.clearError();
            }}
            onBlur={() => void savePath()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                event.currentTarget.blur();
            }}
            className="w-full font-mono text-mobile-input-safe sm:text-ui-base"
          />
        </div>
      </section>
      {management.error && !dialog && !removeTarget ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-ui-sm text-destructive">
          {t(management.error)}
          {management.error === "loadFailed" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void management.refresh()}
              disabled={management.busy}
            >
              <RefreshCw />
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {PROVIDERS.map(({ id, label, icon: Icon }) => (
        <section
          key={id}
          className="min-w-0 space-y-3 border-t border-border pt-4"
          data-testid={`vc-provider-${id}`}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-ui-base font-medium">
              <Icon className="size-4 shrink-0 text-foreground-subtle" />
              {label}
              {id === "git" ? ` · ${t("genericAccounts")}` : ` · ${t("accounts")}`}
            </h2>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => openDialog(id)}
              aria-label={`${t("addAccount")} ${label}`}
            >
              <Plus />
              {t("addAccount")}
            </Button>
          </div>
          {management.settings.accounts.filter((account) => account.provider === id).length ? (
            <div className="divide-y divide-border">
              {management.settings.accounts
                .filter((account) => account.provider === id)
                .map((account) => (
                  <div
                    key={account.id}
                    data-testid="vc-account"
                    data-account-id={account.id}
                    className="flex min-w-0 flex-wrap items-center gap-3 py-3"
                  >
                    <Avatar size="sm">
                      <AvatarImage src={account.avatarUrl ?? undefined} alt={account.username} />
                      <AvatarFallback>
                        {Array.from(account.username)[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 basis-36">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all text-ui-base font-medium">
                          {account.username}
                        </span>
                        {account.isDefault ? (
                          <span
                            className="text-ui-xs text-foreground-subtle"
                            data-testid="vc-default"
                          >
                            {t("default")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 break-all font-mono text-ui-sm text-foreground-subtle">
                        {account.serverUrl}
                      </p>
                      {account.scopes.length ? (
                        <p className="mt-1 break-words text-ui-sm text-foreground-subtlest">
                          {account.scopes.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <AccountAction
                        label={t(account.provider === "git" ? "testCredential" : "testConnection")}
                        disabled={disabled}
                        onClick={() => void testAccount(account.id)}
                      >
                        {testingId === account.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckCircle2 />
                        )}
                      </AccountAction>
                      <AccountAction
                        label={t("updateCredential")}
                        disabled={disabled}
                        onClick={() => openDialog(account.provider, account)}
                      >
                        <KeyRound />
                      </AccountAction>
                      <AccountAction
                        label={t("setDefault")}
                        disabled={disabled || account.isDefault}
                        onClick={() => void management.setDefault(account.id)}
                      >
                        <Star className={account.isDefault ? "fill-current" : ""} />
                      </AccountAction>
                      <AccountAction
                        label={t("removeAccount")}
                        disabled={disabled}
                        onClick={() => {
                          management.clearError();
                          setRemoveTarget(account);
                        }}
                      >
                        <Trash2 className="text-destructive" />
                      </AccountAction>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="py-2 text-ui-sm text-foreground-subtle">{t("noAccounts")}</p>
          )}
        </section>
      ))}
      {dialog ? (
        <VersionControlAccountDialog
          key={dialog.existing?.id ?? dialog.provider}
          {...dialog}
          management={management}
          onClose={() => {
            setDialog(null);
            management.clearError();
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !management.busy) setRemoveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!management.busy}>
          <DialogHeader>
            <DialogTitle>{t("removeAccount")}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage(
                { id: "settings.versionControl.removeConfirm" },
                { username: removeTarget?.username ?? "" },
              )}
            </DialogDescription>
          </DialogHeader>
          {management.error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {t(management.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={management.busy}
              onClick={() => setRemoveTarget(null)}
            >
              <X />
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={management.busy}
              onClick={async () => {
                if (removeTarget && (await management.removeAccount(removeTarget.id)))
                  setRemoveTarget(null);
              }}
            >
              {management.busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t("removeAccount")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
