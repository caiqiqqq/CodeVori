import { createHash } from "node:crypto";
import { BrowserWindow, session } from "electron";
import {
  forgeWebUploadContextSchema,
  forgeImageUploadResultSchema,
  type ForgeWebUploadContext,
  type ForgeImageUploadResult,
} from "@zcode/shared";
import { githubIssueUploadScript } from "./githubIssueUploadScript.js";

export async function executeGithubImageUpload(params: {
  win: BrowserWindow;
  context: ForgeWebUploadContext;
  signal: AbortSignal;
}): Promise<ForgeImageUploadResult> {
  const context = forgeWebUploadContextSchema.parse(params.context);
  const serverUrl = new URL(context.serverUrl);
  const repoUrl = new URL(context.repositoryUrl);
  if (
    serverUrl.href !== "https://github.com/" ||
    repoUrl.origin !== "https://github.com" ||
    repoUrl.username ||
    repoUrl.password ||
    repoUrl.search ||
    repoUrl.hash ||
    repoUrl.pathname !== `/${context.repository.split("/").map(encodeURIComponent).join("/")}` ||
    !/^[\w.-]+\/[\w.-]+$/.test(context.repository)
  )
    return Promise.reject(new Error("FORGE_INVALID_MEDIA"));
  if (params.signal.aborted || params.win.isDestroyed())
    return Promise.reject(new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED"));
  const key = createHash("sha256")
    .update(JSON.stringify([context.serverUrl, context.accountId, context.username]))
    .digest("hex");
  const profile = session.fromPartition(`persist:github-issue-upload-${key}`);
  const window = new BrowserWindow({
    parent: params.win,
    title: `GitHub · ${context.username}`,
    width: 900,
    height: 720,
    webPreferences: {
      session: profile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const pageUrl = `${repoUrl.href}/issues/new`;
  return new Promise((resolve, reject) => {
    let settled = false,
      executing = false;
    const finish = (value?: ForgeImageUploadResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      params.signal.removeEventListener("abort", cancelled);
      params.win.removeListener("close", cancelled);
      params.win.removeListener("closed", cancelled);
      window.removeListener("closed", cancelled);
      if (!window.isDestroyed()) window.destroy();
      if (value) resolve(value);
      else reject(error instanceof Error ? error : new Error("FORGE_UPLOAD_UNAVAILABLE"));
    };
    const cancelled = () => finish(undefined, new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED"));
    const deadline = setTimeout(
      () => finish(undefined, new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED")),
      600_000,
    );
    params.signal.addEventListener("abort", cancelled, { once: true });
    params.win.once("close", cancelled);
    params.win.once("closed", cancelled);
    window.once("closed", cancelled);
    window.webContents.on("did-finish-load", () => {
      if (settled || executing) return;
      // 登录/SSO 页面由用户完成；只向固定仓库页面传递图片，不向认证页或跨站跳转注入字节。
      if (window.webContents.getURL() !== pageUrl) return;
      executing = true;
      void window.webContents.executeJavaScript(githubIssueUploadScript(context), true).then(
        (result: unknown) => {
          const uploaded = forgeImageUploadResultSchema.safeParse(result);
          if (!uploaded.success) {
            finish(undefined, new Error("FORGE_RESPONSE"));
            return;
          }
          const url = new URL(uploaded.data.url);
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
            finish(undefined, new Error("FORGE_INVALID_MEDIA"));
          else finish(uploaded.data);
        },
        async (error: unknown) => {
          const message =
            error instanceof Error ? error.message.match(/FORGE_[A-Z_]+/)?.[0] : undefined;
          // 错误账号的隔离登录态不能让每次重试都立即失败；仅清理本功能的账号 partition，下一次显式重试重新登录。
          if (message === "FORGE_MEDIA_IDENTITY_CHANGED") {
            try {
              await profile.clearStorageData({ storages: ["cookies", "localstorage"] });
            } catch {
              /* 保留明确的账号不匹配错误。 */
            }
          }
          finish(undefined, new Error(message ?? "FORGE_UPLOAD_UNCERTAIN"));
        },
      );
    });
    if (params.signal.aborted || params.win.isDestroyed()) cancelled();
    else void window.loadURL(pageUrl).catch(() => finish(undefined, new Error("FORGE_NETWORK")));
  });
}
