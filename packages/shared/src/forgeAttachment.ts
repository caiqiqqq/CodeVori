import type { ForgeRepository } from "./forge.js";

const UUID = "[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12}";
const GITHUB_ATTACHMENT = new RegExp(`^/user-attachments/assets/${UUID}$`, "i");
const GITEA_ATTACHMENT = new RegExp(`^/attachments/(${UUID})$`, "i");
const GITEA_ISSUE_ATTACHMENT = new RegExp(`^/issues/[1-9]\\d*/attachments/(${UUID})$`, "i");

function safeFilename(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return (
      Boolean(decoded) &&
      ![".", ".."].includes(decoded) &&
      // eslint-disable-next-line no-control-regex -- 附件名必须是一个安全路径段，不能编码分隔符或控制字符。
      !/[/\\\u0000-\u001f\u007f]/.test(decoded)
    );
  } catch {
    return false;
  }
}

/** Pure UI/Host contract: returns only the provider's credential-eligible download endpoint. */
export function forgeAttachmentDownloadUrl(
  repository: Pick<ForgeRepository, "provider" | "name" | "url">,
  source: string,
): string | null {
  try {
    const project = new URL(repository.url);
    const url = new URL(source);
    const suffix = `/${repository.name.split("/").map(encodeURIComponent).join("/")}`;
    if (
      !["https:", "http:"].includes(project.protocol) ||
      project.username ||
      project.password ||
      project.search ||
      project.hash ||
      !project.pathname.endsWith(suffix) ||
      url.origin !== project.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const base = project.pathname.slice(0, -suffix.length);
    if (!url.pathname.startsWith(`${base}/`)) return null;
    const path = url.pathname.slice(base.length);
    if (repository.provider === "github") {
      const cloud = project.hostname === "github.com";
      if (cloud && (project.origin !== "https://github.com" || base)) return null;
      if (GITHUB_ATTACHMENT.test(path)) return url.href;
      const legacy = !cloud && path.match(/^\/files\/[1-9]\d*\/([^/]+)$/);
      return legacy && safeFilename(legacy[1]!) ? url.href : null;
    }
    if (repository.provider !== "gitea") return null;
    const repoPath = `${suffix}/`;
    const localPath = path.startsWith(repoPath) ? path.slice(suffix.length) : path;
    const match =
      GITEA_ATTACHMENT.exec(localPath) ??
      (path.startsWith(repoPath) ? GITEA_ISSUE_ATTACHMENT.exec(localPath) : null);
    // Gitea 的 issue 路径不一定支持 PAT；UUID 全局下载路由明确支持令牌，并由服务端检查附件权限。
    return match ? new URL(`${base}/attachments/${match[1]}`, project.origin).href : null;
  } catch {
    return null;
  }
}
