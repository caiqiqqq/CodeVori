import { marked } from "marked";
import type { ForgeItem, ForgeRepository, ForgeTargetRequest } from "@zcode/shared";
import type { IGitService } from "@zcode/services";
import {
  isGithubAttachmentImage,
  isGiteaAttachmentImage,
  isGitlabUploadImage,
  resolveForgeContentUrl,
} from "./forgeContent.js";
import { MAX_CHAT_ATTACHMENTS } from "./chatAttachments.js";

/** Only rendered images are candidates; code examples and links stay quoted text. */
export function forgeTaskImageSources(repository: ForgeRepository, item: ForgeItem): string[] {
  const sources = new Set<string>();
  const add = (source: string) => {
    const url = resolveForgeContentUrl(repository, item.url, source);
    if (
      url &&
      (isGithubAttachmentImage(repository, url) ||
        isGitlabUploadImage(repository, url) ||
        isGiteaAttachmentImage(repository, url))
    )
      sources.add(url);
  };
  // template 内容保持 inert：不会执行正文脚本、加载图片或挂载到可见页面。
  // 完整解析正文保留 HTML pre/code 上下文，并复用 Markdown 的引用与转义规则。
  const template = document.createElement("template");
  template.innerHTML = marked.parse(item.body, { async: false });
  for (const image of template.content.querySelectorAll("img[src]")) {
    if (!image.closest("pre, code")) add(image.getAttribute("src")!);
  }
  return [...sources].slice(0, MAX_CHAT_ATTACHMENTS);
}

/** Bound Host raster reads only; Files are uploaded by the task composer on Save. */
export async function prepareForgeTaskImages(
  repository: ForgeRepository,
  item: ForgeItem,
  target: ForgeTargetRequest,
  git: IGitService,
  isCurrent: () => boolean,
): Promise<File[]> {
  const files: File[] = [];
  for (const url of forgeTaskImageSources(repository, item)) {
    // 修复原因：议题正文原先只进入文本；截图必须走已验证的 Host 读取与任务附件通道。
    // 切换项目后不继续旧目标的读取，也不把迟到图片带入新草稿。
    if (!isCurrent()) return [];
    let preview;
    try {
      preview = await git.readForgeImage({ ...target, url });
    } catch {
      throw new Error("FORGE_TASK_IMAGE_READ");
    }
    if (!isCurrent()) return [];
    const bytes = Uint8Array.from(atob(preview.dataBase64), (character) => character.charCodeAt(0));
    const extension = preview.mediaType === "image/jpeg" ? "jpg" : preview.mediaType.slice(6);
    files.push(
      new File([bytes], `issue-${item.number}-image-${files.length + 1}.${extension}`, {
        type: preview.mediaType,
      }),
    );
  }
  return files;
}
