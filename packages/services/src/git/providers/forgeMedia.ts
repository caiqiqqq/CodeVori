import { forgeImagePreviewSchema, type ForgeImagePreview } from "@zcode/shared";

export function gitlabUploadApiPath(
  repository: string,
  repositoryUrl: string,
  source: string,
): string {
  const project = new URL(repositoryUrl);
  const url = new URL(source);
  const prefix = `${project.pathname.replace(/\/$/, "")}/uploads/`;
  // 正文 URL 不可信：只接受当前项目的上传路径，再构造 API 地址，不能携带账号抓取任意 URL。
  if (
    url.origin !== project.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  ) {
    throw new Error("FORGE_INVALID_MEDIA");
  }
  const match = url.pathname.slice(prefix.length).match(/^([a-f\d]{32})\/([^/]+)$/i);
  if (!match) throw new Error("FORGE_INVALID_MEDIA");
  let filename: string;
  try {
    filename = decodeURIComponent(match[2]!);
  } catch {
    throw new Error("FORGE_INVALID_MEDIA");
  }
  // eslint-disable-next-line no-control-regex -- 上传文件名不允许路径分隔符和控制字符。
  if (!filename || /[/\\\u0000-\u001f]/.test(filename) || filename === "." || filename === "..")
    throw new Error("FORGE_INVALID_MEDIA");
  return `projects/${encodeURIComponent(repository)}/uploads/${match[1]}/${encodeURIComponent(filename)}`;
}

export function rasterImagePreview(bytes: Buffer, contentType: string | null): ForgeImagePreview {
  const declaredType = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  const signature = bytes.subarray(0, 12);
  const mediaType = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(signature.subarray(0, 6).toString("ascii"))
        ? "image/gif"
        : signature.subarray(0, 4).toString("ascii") === "RIFF" &&
            signature.subarray(8, 12).toString("ascii") === "WEBP"
          ? "image/webp"
          : signature.subarray(4, 8).toString("ascii") === "ftyp" &&
              ["avif", "avis"].includes(signature.subarray(8, 12).toString("ascii"))
            ? "image/avif"
            : null;
  // 附件下载可能只声明通用二进制；按允许的图片签名确定 Blob 类型，仍拒绝 HTML/SVG 和声明不匹配。
  if (
    !mediaType ||
    (declaredType && declaredType !== "application/octet-stream" && declaredType !== mediaType)
  )
    throw new Error("FORGE_RESPONSE");
  return forgeImagePreviewSchema.parse({
    mediaType,
    dataBase64: bytes.toString("base64"),
    totalBytes: bytes.length,
  });
}

export async function readForgeImageResponse(response: Response): Promise<ForgeImagePreview> {
  if (!response.ok) {
    await response.body?.cancel();
    const code =
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 300 && response.status < 400)
        ? "MEDIA_AUTHENTICATION"
        : response.status === 404
          ? "NOT_FOUND"
          : response.status === 429
            ? "RATE_LIMIT"
            : "RESPONSE";
    throw new Error(`FORGE_${code}`);
  }
  try {
    return rasterImagePreview(
      await readForgeResponseBytes(response, 12 * 1024 * 1024),
      response.headers.get("content-type"),
    );
  } catch {
    throw new Error("FORGE_RESPONSE");
  }
}

export async function readForgeResponseBytes(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("FORGE_RESPONSE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("FORGE_RESPONSE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function gitlabWebLoginUrl(
  repository: string,
  projectPath: unknown,
  webUrl: unknown,
  accessRepositoryUrl?: string,
): string {
  if (projectPath !== repository || typeof webUrl !== "string") throw new Error("FORGE_RESPONSE");
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    throw new Error("FORGE_RESPONSE");
  }
  const suffix = `/${repository.split("/").map(encodeURIComponent).join("/")}`;
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(suffix)
  )
    throw new Error("FORGE_RESPONSE");
  // 先核验服务端项目，再使用已绑定的访问地址；升级后返回内网 web_url 不能把登录窗口带到内网。
  if (accessRepositoryUrl !== undefined)
    return gitlabWebLoginUrl(repository, projectPath, accessRepositoryUrl);
  url.pathname = `${url.pathname.slice(0, -suffix.length)}/users/sign_in`;
  return url.href;
}
