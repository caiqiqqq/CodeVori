import { DIRECTORY_ATTACHMENT_MIME } from "@zcode/shared";
import type { IFileService } from "@zcode/services";
import type { ComposerAttachmentUploadItem } from "@/store/composerAttachmentUploadStore.js";

/** Host stat is a display hint only; submission always validates the actual target again. */
export async function classifyPathAttachment(
  item: ComposerAttachmentUploadItem,
  files: Pick<IFileService, "stat">,
): Promise<ComposerAttachmentUploadItem> {
  if (!item.localPath) return item;
  const info = await files.stat({ path: item.localPath });
  if (info.type !== "directory") return item;
  return {
    ...item,
    mimeType: DIRECTORY_ATTACHMENT_MIME,
    sizeBytes: 0,
    ...(item.attachmentRef?.ref === item.localPath
      ? { attachmentRef: { ...item.attachmentRef, mime: DIRECTORY_ATTACHMENT_MIME, bytes: 0 } }
      : {}),
  };
}
