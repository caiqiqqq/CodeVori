import {
  CircleCheck,
  CircleDot,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  RotateCw,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { ForgeAuthor, ForgeItem, ForgeLabel } from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { safeRepositoryExternalUrl } from "@/lib/forgePanel.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function useRepositoryMessages() {
  const { intl } = useZCodeIntl();
  return (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `repositoryPanel.${key}` }, values);
}

export function RepositoryIconButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "size"> & { label: string; children: ReactNode }) {
  return (
    <ControlHintTooltip title={label}>
      <Button type="button" variant="ghost" size="icon-lg" aria-label={label} {...props}>
        {children}
      </Button>
    </ControlHintTooltip>
  );
}

export function RepositoryLoading() {
  const t = useRepositoryMessages();
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-10 text-ui-sm text-foreground-subtle"
    >
      <LoaderCircle className="size-4 animate-spin" />
      {t("loading")}
    </div>
  );
}

const errorKeys = new Set([
  "DISCONNECTED",
  "NETWORK",
  "AUTHENTICATION",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMIT",
  "TARGET_CHANGED",
  "MISSING_ACCOUNT",
  "HEAD_CHANGED",
  "MERGE_BLOCKED",
  "MERGE_UNSUPPORTED",
  "CONFLICT",
  "INVALID_MEDIA",
  "MEDIA_UNAVAILABLE",
  "NO_EXECUTION",
  "TASK_SAVE",
  "TASK_UNSUPPORTED",
  "UPLOAD_LIMIT",
  "UPLOAD_INVALID_FILE",
  "UPLOAD_UNAVAILABLE",
  "UPLOAD_UNCERTAIN",
  "UPLOAD_BUSY",
  "BODY_TOO_LONG",
  "MEDIA_IDENTITY_CHANGED",
  "MEDIA_AUTHENTICATION_CANCELLED",
]);
export function RepositoryError({ error, retry }: { error: string; retry?: () => void }) {
  const t = useRepositoryMessages();
  const code = error.replace(/^FORGE_/, "");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 py-3 text-ui-sm text-destructive"
    >
      <span className="min-w-0 flex-1 break-words">
        {t(`error.${errorKeys.has(code) ? code : "RESPONSE"}`)}
      </span>
      {retry ? (
        <Button variant="outline" size="sm" onClick={retry}>
          <RotateCw className="size-3.5" />
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function RepositoryItemIcon({
  item,
}: {
  item: Pick<ForgeItem, "kind" | "state" | "draft">;
}) {
  const Icon =
    item.state === "merged"
      ? GitMerge
      : item.kind === "pull-request"
        ? GitPullRequest
        : item.state === "closed"
          ? CircleCheck
          : CircleDot;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        item.draft
          ? "text-foreground-subtle"
          : item.state === "open"
            ? "text-success"
            : "text-foreground-subtle",
      )}
    />
  );
}

export function RepositoryItemStatus({
  item,
}: {
  item: Pick<ForgeItem, "kind" | "state" | "draft">;
}) {
  const t = useRepositoryMessages();
  return (
    <span className="inline-flex items-center gap-1.5 text-ui-sm">
      <RepositoryItemIcon item={item} />
      {t(item.draft && item.state === "open" ? "draft" : `state.${item.state}`)}
    </span>
  );
}

export function RepositoryAuthor({ author }: { author: ForgeAuthor }) {
  const name = author.displayName || author.username;
  const avatarUrl = author.avatarUrl ? safeRepositoryExternalUrl(author.avatarUrl) : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-ui-sm">
      <Avatar size="sm">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}
        <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]" title={`@${author.username}`}>
        {name}
      </span>
    </span>
  );
}

export function RepositoryLabels({ labels }: { labels: ForgeLabel[] }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
      {labels.map((label) => (
        <span
          key={label.key}
          className="inline-flex min-w-0 items-center gap-1.5 text-ui-xs text-foreground-subtle"
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-foreground-subtlest"
            style={label.color ? { backgroundColor: label.color } : undefined}
          />
          <span className="break-all">{label.name}</span>
        </span>
      ))}
    </span>
  );
}

export function RepositoryTime({
  value,
  dateOnly = false,
}: {
  value: string | null;
  dateOnly?: boolean;
}) {
  const { locale } = useZCodeIntl();
  // 截止日是日历日期，按 UTC 展示以避免负时区退到前一天；事件时间仍按用户时区展示。
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? (
    <time
      dateTime={date.toISOString()}
      title={
        dateOnly
          ? date.toLocaleDateString(locale, { dateStyle: "long", timeZone: "UTC" })
          : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
      }
    >
      {date.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        ...(dateOnly ? { year: "numeric", timeZone: "UTC" } : {}),
      })}
    </time>
  ) : null;
}

export function RepositoryExternalButton({
  url,
  label,
  onOpen,
}: {
  url: string | null;
  label: string;
  onOpen: (url: string) => void;
}) {
  return url ? (
    <RepositoryIconButton label={label} onClick={() => onOpen(url)}>
      <ExternalLink className="size-4" />
    </RepositoryIconButton>
  ) : null;
}
