import type { AcpPromptAttachment } from "@zcode/shared";
import { buildFileMentionMarkdown } from "../../mentions/mentionMarkdown.js";
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

/** 恢复已接受的文件引用为 editor mentions，保留原正文中的位置，避免每次撤回重复追加链接。 */
export function acpQueuedEditorState(text: string, workspaceFiles: readonly string[]): string {
  const textNode = (text: string) => ({
    type: "text",
    version: 1,
    text,
    format: 0,
    detail: 0,
    mode: "normal",
    style: "",
  });
  const normalize = (path: string) => path.replace(/^\.\//, "").replace(/\/$/, "");
  const remaining = new Set(workspaceFiles);
  const mention = (path: string, label: string, markdown: string) => ({
    ...textNode(label),
    type: "prompt-mention",
    mode: "token",
    category: "files",
    mentionId: `file:${path}`,
    value: path,
    markdown,
  });
  const paragraphs = text.split("\n\n").map((line) => {
    const children: Record<string, unknown>[] = [];
    let cursor = 0;
    for (const match of line.matchAll(
      /\[((?:\\.|[^\\\]])*)\]\((?:<((?:\\.|[^>])*?)>|((?:\\.|[^)])*))\)/g,
    )) {
      const destination = (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1");
      const path = workspaceFiles.find((path) => normalize(path) === normalize(destination));
      if (!path) continue;
      if (match.index > cursor) children.push(textNode(line.slice(cursor, match.index)));
      children.push(mention(path, match[1]!.replace(/\\(.)/g, "$1"), match[0]));
      remaining.delete(path);
      cursor = match.index + match[0].length;
    }
    if (cursor < line.length) children.push(textNode(line.slice(cursor)));
    return { type: "paragraph", version: 1, format: "", indent: 0, direction: null, children };
  });
  // 内部提交可带正文中不存在的引用；仍恢复为可见、可删除的 mention，不保留隐藏的引用状态。
  for (const path of remaining) {
    const children = paragraphs.at(-1)!.children;
    if (children.length) children.push(textNode(" "));
    children.push(mention(path, path, buildFileMentionMarkdown(path, path)));
  }
  return JSON.stringify({
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: null,
      children: paragraphs,
    },
  });
}
