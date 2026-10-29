import { createHash } from "node:crypto";
import {
  forgeImageRequestSchema,
  forgeImagePreviewSchema,
  type ForgeImagePreview,
  type ForgeImageRequest,
  type ForgeRepository,
  type ForgeTargetRequest,
} from "@zcode/shared";
import type { ForgeProviderAdapter } from "./providers/forgeProvider.js";

interface Target {
  adapter: ForgeProviderAdapter;
  repository: ForgeRepository;
  account: { id: string; username: string; secret: string; serverUrl: string };
}

/** One Host's bounded raster content; no credentials, signed redirects or object URLs. */
export class ForgeImageCache {
  private readonly images = new Map<string, ForgeImagePreview>();
  private readonly pending = new Map<string, Promise<ForgeImagePreview>>();
  private bytes = 0;
  constructor(
    private readonly maxEntries = 32,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  forget(key: string) {
    const previous = this.images.get(key);
    if (previous) this.bytes -= previous.dataBase64.length;
    this.images.delete(key);
    this.pending.delete(key);
  }

  async read(key: string, load: () => Promise<ForgeImagePreview>): Promise<ForgeImagePreview> {
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return { ...cached };
    }
    const existing = this.pending.get(key);
    if (existing) return { ...(await existing) };
    // pending 也有界；超过并发预算时照常读取，但不持有额外缓存状态。
    if (this.pending.size >= this.maxEntries) return load();
    const result = Promise.resolve().then(load);
    this.pending.set(key, result);
    try {
      const image = await result;
      const size = image.dataBase64.length;
      if (this.pending.get(key) === result && size <= this.maxBytes) {
        while (this.images.size >= this.maxEntries || this.bytes + size > this.maxBytes)
          this.forget(this.images.keys().next().value!);
        this.images.set(key, { ...image });
        this.bytes += size;
      }
      return { ...image };
    } finally {
      // 失败不缓存；鉴权失效后晚到的旧请求不能删掉新代次的读取。
      if (this.pending.get(key) === result) this.pending.delete(key);
    }
  }
}

function imageKey(request: ForgeImageRequest, resolved: Target): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.workspaceIdentity?.trim() || request.workspacePath,
        request.workspacePath,
        request.remoteName,
        request.repositoryKey,
        request.accountId,
        resolved.repository.url,
        resolved.account.serverUrl,
        resolved.account.username,
        resolved.account.secret,
        request.url,
      ]),
    )
    .digest("hex");
}

export function createForgeImageReads(target: (request: ForgeTargetRequest) => Promise<Target>) {
  const cache = new ForgeImageCache();
  return {
    async readForgeImage(input: unknown) {
      const request = forgeImageRequestSchema.parse(input);
      const original = await target(request);
      if (!original.adapter.readImage) throw new Error("FORGE_MEDIA_UNAVAILABLE");
      const key = imageKey(request, original);
      // 解码失败的图片也可能已缓存；用户明确重试时必须取新字节，且只能在验证目标后失效当前 key。
      if (request.refresh) cache.forget(key);
      // 修复原因：处理同一议题曾反复下载截图；只有已核对目标和凭据的 Host 才能复用内容。
      const image = await cache.read(key, async () => {
        const preview = forgeImagePreviewSchema.parse(await original.adapter.readImage!(request));
        if (imageKey(request, await target(request)) !== key)
          throw new Error("FORGE_TARGET_CHANGED");
        return preview;
      });
      if (imageKey(request, await target(request)) !== key) {
        cache.forget(key);
        throw new Error("FORGE_TARGET_CHANGED");
      }
      return image;
    },
    async authenticateForgeImage(input: unknown) {
      const request = forgeImageRequestSchema.parse(input);
      const original = await target(request);
      if (!original.adapter.authenticateImage)
        throw new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE");
      await original.adapter.authenticateImage(request);
      if (imageKey(request, await target(request)) !== imageKey(request, original))
        throw new Error("FORGE_TARGET_CHANGED");
      cache.forget(imageKey(request, original));
    },
  };
}
