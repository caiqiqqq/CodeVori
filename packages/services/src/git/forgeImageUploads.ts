import { createHash } from "node:crypto";
import {
  forgeImageUploadRequestSchema,
  forgeImageUploadResultSchema,
  forgeImageUploadFileSchema,
  forgeTargetRequestSchema,
  type ForgeTargetRequest,
  type ForgeRepository,
  type ForgeImageUploadResult,
  type ForgeWebMediaPort,
} from "@zcode/shared";
import type { ForgeProviderAdapter } from "./providers/forgeProvider.js";
import { rasterImagePreview, gitlabUploadApiPath } from "./providers/forgeMedia.js";

interface Target {
  adapter: ForgeProviderAdapter;
  repository: ForgeRepository;
  account: { id: string; username: string; secret: string; serverUrl: string };
}

export function createForgeImageUploads(
  target: (request: ForgeTargetRequest) => Promise<Target>,
  webMedia?: ForgeWebMediaPort,
) {
  const receipts = new Map<
    string,
    { digest: string; settled: boolean; result: Promise<ForgeImageUploadResult> }
  >();
  const capability = (resolved: Target) => {
    const github = resolved.repository.provider === "github";
    const supported = github
      ? Boolean(webMedia?.upload) &&
        new URL(resolved.repository.url).origin === "https://github.com"
      : Boolean(resolved.adapter.uploadImage);
    return {
      supported,
      requiresWebLogin: github && supported,
      ...(!supported
        ? {
            reason: github ? ("web-login-unavailable" as const) : ("provider-unsupported" as const),
          }
        : {}),
    };
  };
  return {
    async getForgeImageUploadCapability(input: ForgeTargetRequest) {
      return capability(await target(forgeTargetRequestSchema.parse(input)));
    },
    async uploadForgeImage(input: unknown) {
      const parsed = forgeImageUploadRequestSchema.safeParse(input);
      if (!parsed.success) throw new Error("FORGE_INVALID_MEDIA");
      const request = parsed.data;
      const bytes = Buffer.from(request.dataBase64, "base64");
      if (bytes.length !== request.totalBytes || bytes.toString("base64") !== request.dataBase64)
        throw new Error("FORGE_INVALID_MEDIA");
      try {
        rasterImagePreview(bytes, request.mediaType);
      } catch {
        throw new Error("FORGE_INVALID_MEDIA");
      }
      const original = await target(request);
      if (!capability(original).supported) throw new Error("FORGE_MEDIA_UNAVAILABLE");
      const key = JSON.stringify([
        request.workspaceIdentity?.trim() || request.workspacePath,
        request.repositoryKey,
        request.remoteName,
        request.accountId,
        request.requestId,
      ]);
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            request.filename,
            request.mediaType,
            request.workspacePath,
            original.account.secret,
          ]),
        )
        .update(bytes)
        .digest("hex");
      let receipt = receipts.get(key);
      if (receipt && receipt.digest !== digest) throw new Error("FORGE_CONFLICT");
      if (!receipt) {
        // 手机重连重发同一请求时复用 Host 回执；只有显式重试的新请求号才允许再次写入平台。
        if (receipts.size >= 128) {
          for (const [id, entry] of receipts) {
            if (entry.settled) receipts.delete(id);
            if (receipts.size < 128) break;
          }
          if (receipts.size >= 128) throw new Error("FORGE_UPLOAD_BUSY");
        }
        const entry = { digest, settled: false, result: Promise.resolve({ url: "" }) };
        entry.result = (async () => {
          const result =
            original.repository.provider === "github"
              ? await webMedia!.upload!({
                  accountId: original.account.id,
                  username: original.account.username,
                  serverUrl: original.account.serverUrl,
                  repository: original.repository.name,
                  repositoryUrl: original.repository.url,
                  image: forgeImageUploadFileSchema.parse(request),
                })
              : await original.adapter.uploadImage!(request);
          const uploaded = forgeImageUploadResultSchema.parse(result);
          const url = new URL(uploaded.url);
          if (original.repository.provider === "github") {
            if (
              url.origin !== "https://github.com" ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              !/^\/user-attachments\/assets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(
                url.pathname,
              )
            )
              throw new Error("FORGE_INVALID_MEDIA");
          } else
            gitlabUploadApiPath(original.repository.name, original.repository.url, uploaded.url);
          return { url: url.href.replaceAll("(", "%28").replaceAll(")", "%29") };
        })().finally(() => {
          entry.settled = true;
        });
        receipt = entry;
        receipts.set(key, entry);
      }
      const result = await receipt.result;
      const latest = await target(request);
      // 登录/上传期间账号可能被替换；旧凭据完成的上传不能给新账号草稿回填链接。
      if (
        latest.account.secret !== original.account.secret ||
        latest.account.username !== original.account.username
      )
        throw new Error("FORGE_TARGET_CHANGED");
      return result;
    },
  };
}
