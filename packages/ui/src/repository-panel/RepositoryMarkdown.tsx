import { useMemo, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import type { ForgeItemRequest, ForgeRepository } from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import { MessageResponse } from "@/components/ai-elements/message.js";
import type { MarkdownImageProps } from "@/components/ai-elements/markdown-image.js";
import { ImagePreviewDialog } from "@/components/ai-elements/image-preview-dialog.js";
import { useRepositoryImage } from "@/hooks/useRepositoryImage.js";
import {
  isGithubAttachmentImage,
  isGiteaAttachmentImage,
  isGitlabUploadImage,
  resolveForgeContentUrl,
} from "@/lib/forgeContent.js";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type { Theme } from "@/useTheme.js";
import { Button } from "@/components/ui/button.js";
import { RepositoryExternalButton, useRepositoryMessages } from "./RepositoryParts.js";

export interface RepositoryContentContext {
  request: ForgeItemRequest;
  repository: ForgeRepository;
  gitService: IGitService;
  itemUrl: string | null;
  active: boolean;
  onOpen: (url: string) => void;
}

const imageErrorMessages: Record<string, string> = {
  NETWORK: "imageNetworkError",
  DISCONNECTED: "imageNetworkError",
  AUTHENTICATION: "imagePermissionError",
  FORBIDDEN: "imagePermissionError",
  MISSING_ACCOUNT: "imagePermissionError",
  NOT_FOUND: "imageNotFound",
  RATE_LIMIT: "imageRateLimited",
  RESPONSE: "imageInvalidContent",
  IMAGE_DECODE: "imageInvalidContent",
};

function RepositoryImage({
  source,
  alt,
  context,
}: {
  source: string;
  alt?: string;
  context: RepositoryContentContext;
}) {
  const t = useRepositoryMessages();
  const privateUpload = isGitlabUploadImage(context.repository, source);
  // 各平台私有附件必须由绑定 Host 的账号读取；匿名 img 会返回 404 或登录页。
  const hostRead =
    privateUpload ||
    isGithubAttachmentImage(context.repository, source) ||
    isGiteaAttachmentImage(context.repository, source);
  const media = useRepositoryImage(
    context.request,
    context.gitService,
    hostRead ? source : null,
    context.active,
  );
  const url = hostRead ? media.url : source;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [publicRevision, setPublicRevision] = useState(0);
  const [preview, setPreview] = useState(false);
  const error = media.error || (url && failedUrl === url ? "IMAGE_DECODE" : null);
  const needsSignIn =
    privateUpload && (error === "MEDIA_AUTHENTICATION" || error === "MEDIA_IDENTITY_CHANGED");
  return (
    <div className="my-4 min-w-0" data-testid="repository-image">
      {error ? (
        <div
          className="flex min-h-32 flex-wrap items-center justify-center gap-3 rounded-md border border-border px-4 py-6 text-ui-sm text-foreground-subtle"
          role="alert"
        >
          <ImageOff className="size-5" />
          <span>
            {t(
              needsSignIn
                ? error === "MEDIA_IDENTITY_CHANGED"
                  ? "imageAccountMismatch"
                  : "imageNeedsSignIn"
                : error === "MEDIA_AUTHENTICATION_UNAVAILABLE"
                  ? "imageAuthUnavailable"
                  : (imageErrorMessages[error] ?? "imageUnavailable"),
            )}
          </span>
          {needsSignIn ? (
            <Button
              size="sm"
              variant="outline"
              disabled={media.authentication.busy}
              onClick={() => void media.authenticate()}
            >
              {t(media.authentication.busy ? "signingInGitLab" : "signInGitLab")}
            </Button>
          ) : null}
          {media.authentication.error &&
          media.authentication.error !== "MEDIA_AUTHENTICATION_CANCELLED" ? (
            <span>{t("imageSignInFailed")}</span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={media.authentication.busy || media.loading}
            onClick={() => {
              setFailedUrl(null);
              if (hostRead) media.retry();
              else setPublicRevision((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => context.onOpen(source)}>
            {t("openImage")}
          </Button>
          <RepositoryExternalButton
            url={context.itemUrl}
            label={t("openItem")}
            onOpen={context.onOpen}
          />
        </div>
      ) : url ? (
        <button
          type="button"
          onClick={() => setPreview(true)}
          aria-label={t("previewImage")}
          className="block w-full min-w-0 cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <img
            key={`${url}:${publicRevision}`}
            src={url}
            alt={alt || t("image")}
            data-testid="repository-inline-image"
            className="block h-auto w-full max-w-full rounded-md"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(url)}
          />
        </button>
      ) : (
        <div
          role="status"
          className="flex min-h-32 items-center justify-center gap-2 text-ui-sm text-foreground-subtle"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {t("loading")}
        </div>
      )}
      <ImagePreviewDialog
        dialogTestId="repository-image-preview"
        initialIndex={0}
        open={context.active && preview && Boolean(url)}
        onOpenChange={setPreview}
        items={url ? [{ src: url, alt: alt || t("image") }] : []}
      />
    </div>
  );
}

export function RepositoryMarkdown({
  context,
  children,
  theme,
  codePreviewSettings,
}: {
  context: RepositoryContentContext;
  children: string;
  theme: Theme;
  codePreviewSettings: CodePreviewSettings;
}) {
  const webContent = useMemo(
    () => ({
      resolveUrl: (href: string) =>
        resolveForgeContentUrl(context.repository, context.itemUrl, href),
      renderImage: (props: MarkdownImageProps) => {
        const source =
          typeof props.src === "string"
            ? resolveForgeContentUrl(context.repository, context.itemUrl, props.src)
            : null;
        return source ? (
          <RepositoryImage key={source} source={source} alt={props.alt} context={context} />
        ) : null;
      },
    }),
    [context],
  );
  return (
    <MessageResponse
      theme={theme}
      codePreviewSettings={codePreviewSettings}
      onOpenExternalUrl={context.onOpen}
      webContent={webContent}
      className="[&_p]:break-words [overflow-wrap:anywhere] tracking-normal"
    >
      {children}
    </MessageResponse>
  );
}
