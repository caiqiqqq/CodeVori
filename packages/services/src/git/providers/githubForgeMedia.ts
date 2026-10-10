import { readForgeImageResponse } from "./forgeMedia.js";

const ATTACHMENT_PATH = /^\/user-attachments\/assets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const STORAGE_ORIGINS = new Set([
  "https://github-production-user-asset-6210df.s3.amazonaws.com",
  "https://private-user-images.githubusercontent.com",
]);

function mediaUrl(source: string): URL {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("FORGE_INVALID_MEDIA");
  }
  if (url.username || url.password || url.hash) throw new Error("FORGE_INVALID_MEDIA");
  return url;
}

export async function readGithubAttachmentImage(
  repositoryUrl: string,
  source: string,
  secret: string,
  fetcher: typeof fetch,
) {
  const url = mediaUrl(source);
  // 私有 GitHub 附件匿名读取会返回 404；只能向固定附件端点发送当前绑定账号的令牌。
  if (
    mediaUrl(repositoryUrl).origin !== "https://github.com" ||
    url.origin !== "https://github.com" ||
    url.search ||
    !ATTACHMENT_PATH.test(url.pathname)
  )
    throw new Error("FORGE_INVALID_MEDIA");
  const signal = AbortSignal.timeout(15_000);
  const read = async (href: string, authenticated: boolean) => {
    try {
      return await fetcher(href, {
        redirect: "manual",
        credentials: "omit",
        signal,
        headers: {
          Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif",
          "User-Agent": "ZCode",
          ...(authenticated ? { Authorization: `Bearer ${secret}` } : {}),
        },
      });
    } catch {
      throw new Error("FORGE_NETWORK");
    }
  };
  let response = await read(url.href, true);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("FORGE_INVALID_MEDIA");
    const storage = mediaUrl(location);
    if (!STORAGE_ORIGINS.has(storage.origin)) throw new Error("FORGE_INVALID_MEDIA");
    // GitHub 返回带签名的存储地址；只允许一次跳转，后续请求不携带令牌或 Cookie。
    response = await read(storage.href, false);
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new Error(response.status === 401 ? "FORGE_AUTHENTICATION" : "FORGE_FORBIDDEN");
  }
  return readForgeImageResponse(response);
}
