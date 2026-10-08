import type { AcpPromptAttachment } from "@zcode/shared";
import type { ComposerAttachmentUploadItem } from "@/store/composerAttachmentUploadStore.js";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Only actual editor file mentions become Host workspace references. */
export function acpWorkspaceFilesFromEditor(editorStateJson?: string): string[] {
  if (!editorStateJson) return [];
  const state: unknown = JSON.parse(editorStateJson);
  const files = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "prompt-mention" &&
      node.category === "files" &&
      typeof node.value === "string"
    ) {
      files.add(node.value);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
    if (node.root) visit(node.root);
  };
  visit(state);
  return [...files];
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(result);
}

/** RPC 携带输入内容；Host 单独保存附件副本，快照仅记录名称与不透明引用。 */
export async function acpAttachmentsFromComposer(
  attachments: readonly ComposerAttachmentUploadItem[],
  remote: boolean,
): Promise<AcpPromptAttachment[]> {
  if (attachments.length > 8) throw new Error("ACP accepts at most 8 attachments");
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.uploadStatus === "failed") {
        throw new Error(attachment.uploadError ?? `ACP attachment failed: ${attachment.filename}`);
      }
      if (attachment.mimeType.startsWith("video/") || attachment.mimeType.startsWith("audio/")) {
        throw new Error(`ACP cannot send this media type: ${attachment.mimeType}`);
      }
      const common = { fileName: attachment.filename, mimeType: attachment.mimeType };
      if (attachment.localPath) {
        if (remote) {
          if (
            !attachment.staged ||
            !attachment.attachmentRef?.ref ||
            attachment.uploadStatus !== "ready"
          ) {
            throw new Error(`ACP remote attachment is not ready: ${attachment.filename}`);
          }
          return { ...common, path: attachment.attachmentRef.ref };
        }
        return { ...common, path: attachment.localPath };
      }
      if (!attachment.file)
        throw new Error(`ACP attachment has no readable content: ${attachment.filename}`);
      if (attachment.file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`ACP attachment exceeds 20 MiB: ${attachment.filename}`);
      }
      return { ...common, dataBase64: await fileBase64(attachment.file) };
    }),
  );
}
