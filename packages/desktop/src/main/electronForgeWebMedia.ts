import { createHash } from "node:crypto";
import { BrowserWindow, session } from "electron";
import type { ForgeWebMediaContext, ForgeWebUploadContext } from "@zcode/shared";
import { createForgeNativeMediaTransport } from "./forgeWebMedia.js";
import { executeGithubImageUpload } from "./electronGithubImageUpload.js";

export async function executeForgeWebMedia(
  params: {
    win: BrowserWindow;
    signal: AbortSignal;
  } & (
    | { action: "read" | "authenticate"; context: ForgeWebMediaContext }
    | { action: "upload"; context: ForgeWebUploadContext }
  ),
) {
  if (params.action === "upload") return executeGithubImageUpload(params);
  if (params.win.isDestroyed())
    return Promise.reject(new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED"));
  const controller = new AbortController();
  const closed = () => controller.abort();
  // macOS 父窗口关闭时可能等待附属窗口结束；在 close 就取消，不能互相等待 closed。
  params.win.once("close", closed);
  params.win.once("closed", closed);
  const profileFor = (context: ForgeWebMediaContext) => {
    const key = createHash("sha256")
      .update(JSON.stringify([context.serverUrl, context.accountId, context.username]))
      .digest("hex");
    return session.fromPartition(`persist:gitlab-media-${key}`);
  };
  const transport = createForgeNativeMediaTransport({
    session(context) {
      const profile = profileFor(context);
      // Electron Session.fetch 遇到 manual 重定向会抛出网络异常；使用 Node HTTP 保留 302 状态，
      // 只让 Main 内的已验证 Cookie 参与请求，既能显示重新登录入口，也不会跟随重定向。
      return { cookies: profile.cookies, fetch: (url, init) => globalThis.fetch(url, init) };
    },
    openWindow(context) {
      const window = new BrowserWindow({
        parent: params.win,
        title: `GitLab · ${context.username}`,
        width: 900,
        height: 720,
        webPreferences: {
          session: profileFor(context),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      return window;
    },
  });
  const signal = AbortSignal.any([params.signal, controller.signal]);
  return transport(params.action, params.context, signal).finally(() => {
    params.win.removeListener("close", closed);
    params.win.removeListener("closed", closed);
  });
}
