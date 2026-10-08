import { randomUUID } from "node:crypto";
import {
  forgeImagePreviewSchema,
  type ForgeWebMediaContext,
  type ForgeWebMediaPort,
  type ForgeImagePreview,
  type HostForgeWebMediaRequest,
  type HostForgeWebMediaResult,
} from "@zcode/shared";

export function createForgeWebMediaMainBridge(post: (message: HostForgeWebMediaRequest) => void) {
  const authorizations = new Map<string, Promise<ForgeImagePreview | undefined>>();
  const pending = new Map<
    string,
    {
      resolve(value: ForgeImagePreview | undefined): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      action: "read" | "authenticate";
    }
  >();
  let disposed = false;
  const cancel = (requestId: string) => {
    try {
      post({ type: "forge-web-media-request", requestId, action: "cancel" });
    } catch {
      /* Main/Host 已关闭。 */
    }
  };
  const request = (action: "read" | "authenticate", context: ForgeWebMediaContext) =>
    new Promise<ForgeImagePreview | undefined>((resolve, reject) => {
      if (disposed) {
        reject(new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE"));
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(
        () => {
          if (!pending.delete(requestId)) return;
          cancel(requestId);
          reject(
            new Error(
              action === "authenticate" ? "FORGE_MEDIA_AUTHENTICATION_CANCELLED" : "FORGE_NETWORK",
            ),
          );
        },
        action === "authenticate" ? 605_000 : 45_000,
      );
      pending.set(requestId, { resolve, reject, timer, action });
      try {
        post({ type: "forge-web-media-request", requestId, action, context });
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE"));
      }
    });
  const port: ForgeWebMediaPort = {
    async read(context) {
      return forgeImagePreviewSchema.parse(await request("read", context));
    },
    async authenticate(context) {
      const key = JSON.stringify([
        context.serverUrl,
        context.accountId,
        context.username,
        context.loginUrl,
      ]);
      let authorization = authorizations.get(key);
      if (!authorization) {
        // 同页多张图片共用一次登录窗口；只合并在途命令，完成后仍由每个仓库请求重新验证账号。
        authorization = request("authenticate", context).finally(() => authorizations.delete(key));
        authorizations.set(key, authorization);
      }
      await authorization;
    },
  };
  return {
    port,
    handleResult(message: HostForgeWebMediaResult) {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      if (!message.ok) entry.reject(new Error(message.error ?? "FORGE_RESPONSE"));
      else if (entry.action === "read" && !message.preview)
        entry.reject(new Error("FORGE_RESPONSE"));
      else entry.resolve(message.preview);
    },
    dispose() {
      disposed = true;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        cancel(id);
        entry.reject(new Error("FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE"));
      }
      pending.clear();
      authorizations.clear();
    },
  };
}
