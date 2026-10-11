import { forgeAttachmentDownloadUrl, type ForgeRepository } from "@zcode/shared";
import { readForgeImageResponse } from "./forgeMedia.js";

export async function readGiteaAttachmentImage(
  repository: ForgeRepository,
  source: string,
  secret: string,
  fetcher: typeof fetch,
) {
  const endpoint = forgeAttachmentDownloadUrl(repository, source);
  if (repository.provider !== "gitea" || !endpoint) throw new Error("FORGE_INVALID_MEDIA");
  let response: Response;
  try {
    // 附件 API 返回元数据；只有受约束的 UUID 下载端点接收绑定账号令牌，不能跟随登录/外部存储跳转。
    response = await fetcher(endpoint, {
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif",
        "User-Agent": "ZCode",
        Authorization: `token ${secret}`,
      },
    });
  } catch {
    throw new Error("FORGE_NETWORK");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("FORGE_INVALID_MEDIA");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new Error(response.status === 401 ? "FORGE_AUTHENTICATION" : "FORGE_FORBIDDEN");
  }
  return readForgeImageResponse(response);
}
