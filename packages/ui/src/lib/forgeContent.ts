import { forgeAttachmentDownloadUrl, type ForgeRepository } from "@zcode/shared";

export function resolveForgeContentUrl(
  repository: ForgeRepository,
  itemUrl: string | null,
  source: string,
): string | null {
  try {
    const href = source.trim();
    if (!href) return null;
    const projectBase = `${repository.url.replace(/\/$/, "")}/`;
    const upload = repository.provider === "gitlab" && /^\/?uploads\//.test(href);
    const url = new URL(
      upload ? href.replace(/^\//, "") : href,
      upload ? projectBase : (itemUrl ?? projectBase),
    );
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function isGitlabUploadImage(repository: ForgeRepository, source: string): boolean {
  if (repository.provider !== "gitlab") return false;
  try {
    const project = new URL(repository.url);
    const url = new URL(source);
    return (
      url.origin === project.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`${project.pathname.replace(/\/$/, "")}/uploads/`)
    );
  } catch {
    return false;
  }
}

export function isGithubAttachmentImage(repository: ForgeRepository, source: string): boolean {
  return (
    repository.provider === "github" && forgeAttachmentDownloadUrl(repository, source) !== null
  );
}

export function isGiteaAttachmentImage(repository: ForgeRepository, source: string): boolean {
  return repository.provider === "gitea" && forgeAttachmentDownloadUrl(repository, source) !== null;
}
