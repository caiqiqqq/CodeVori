import { useMemo } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { type WorkTaskAttachment, type WorkTaskScope } from "@zcode/shared";
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
} from "@/components/ai-elements/attachments.js";
import { ChatMediaAttachmentPreviewDialog } from "@/ChatMediaAttachmentPreviewDialog.js";
import { useWorkTaskAttachmentPreview } from "@/hooks/useWorkTaskPromptAssets.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatAttachmentSize, type ChatComposerAttachment } from "@/lib/chatAttachments.js";

export function WorkTaskAttachments({
  scope,
  items,
  saved,
  onRemove,
  disabled = false,
  attachmentKind = "all",
  presentation = "compact",
}: {
  scope: WorkTaskScope;
  items?: readonly ChatComposerAttachment[];
  saved?: readonly WorkTaskAttachment[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
  attachmentKind?: "all" | "media" | "file";
  presentation?: "compact" | "conversation";
}) {
  const { intl } = useZCodeIntl();
  const attachments: readonly ChatComposerAttachment[] = useMemo(
    () =>
      items ??
      (saved ?? [])
        .filter((item) => {
          const media = /^(image|video)\//.test(item.mime);
          return attachmentKind === "all" || (attachmentKind === "media" ? media : !media);
        })
        .map((item) => ({
          id: item.ref,
          filename: item.fileName,
          mimeType: item.mime,
          sizeBytes: item.bytes,
          localPath: item.ref,
        })),
    [items, saved, attachmentKind],
  );
  const preview = useWorkTaskAttachmentPreview(scope, attachments);
  if (!attachments.length) return null;
  return (
    <>
      <Attachments
        variant="inline"
        className={`max-w-full gap-2 ${presentation === "conversation" ? "justify-end" : ""}`}
        data-testid="work-task-attachments"
      >
        {attachments.map((attachment) => {
          const media = /^(image|video)\//.test(attachment.mimeType);
          const canPreview = media || attachment.mimeType === "application/pdf";
          const image = attachment.mimeType.startsWith("image/");
          const resource = preview.get(attachment);
          const statusLabel =
            image && (resource.loading || resource.error)
              ? intl.formatMessage({
                  id: resource.error
                    ? "chat.attachments.preview.unavailable"
                    : "chat.attachments.preview.loading",
                })
              : undefined;
          return (
            <Attachment
              key={attachment.id}
              variant={media ? "grid" : "inline"}
              className={
                media
                  ? presentation === "conversation"
                    ? "size-20 rounded-xl border border-border bg-surface"
                    : "size-12 rounded-lg border border-border bg-surface"
                  : "h-12 max-w-full min-w-0 gap-2 rounded-lg border border-border bg-surface p-1.5 pr-6 [--attachment-bg:var(--color-surface)]"
              }
              data={{
                id: attachment.id,
                type: "file",
                filename: attachment.filename,
                mediaType: attachment.mimeType,
                url: resource.url ?? (image ? "" : (attachment.objectUrl ?? "")),
              }}
              title={attachment.filename}
              data-testid="work-task-attachment"
              onOpen={
                canPreview
                  ? () => {
                      void preview.open(attachment);
                    }
                  : undefined
              }
              openLabel={
                canPreview ? intl.formatMessage({ id: "chat.attachments.preview.open" }) : undefined
              }
              onRemove={onRemove && !disabled ? () => onRemove(attachment.id) : undefined}
            >
              <AttachmentPreview
                className={media ? "size-full bg-surface" : "size-9 rounded-md bg-background"}
                title={statusLabel}
                fallbackIcon={
                  statusLabel ? (
                    <>
                      {resource.error ? (
                        <ImageOff className="size-4 text-destructive" aria-hidden />
                      ) : (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      )}
                      <span className="sr-only" role={resource.error ? "alert" : "status"}>
                        {statusLabel}
                      </span>
                    </>
                  ) : undefined
                }
              />
              {!media ? (
                <div className="min-w-0">
                  <AttachmentInfo className="max-w-48 text-ui-base text-foreground" />
                  <span className="text-ui-xs text-foreground-subtlest">
                    {formatAttachmentSize(attachment.sizeBytes)}
                  </span>
                </div>
              ) : null}
              <AttachmentRemove
                alwaysVisible
                label={intl.formatMessage({ id: "chat.attachments.remove" })}
                className={media ? "top-0.5 right-0.5 size-4 rounded-sm opacity-100" : undefined}
                data-testid="work-task-attachment-remove"
              />
            </Attachment>
          );
        })}
      </Attachments>
      <ChatMediaAttachmentPreviewDialog
        attachment={
          preview.preview
            ? {
                filename: preview.preview.attachment.filename,
                mediaType: preview.preview.attachment.mimeType,
                url: preview.preview.url,
              }
            : null
        }
        open={!!preview.preview}
        loading={preview.preview?.loading}
        error={preview.preview?.error}
        onOpenChange={(open) => {
          if (!open) preview.close();
        }}
      />
    </>
  );
}
