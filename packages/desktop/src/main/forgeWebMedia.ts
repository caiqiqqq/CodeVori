import {
  forgeWebMediaContextSchema,
  type ForgeWebMediaContext,
  type ForgeImagePreview,
} from "@zcode/shared";
import {
  gitlabUploadApiPath,
  readForgeImageResponse,
  readForgeResponseBytes,
} from "@zcode/services/node";

export interface ForgeNativeSession {
  cookies: {
    get(filter: { url: string; name: string }): Promise<Array<{ value: string }>>;
    on(event: "changed", listener: () => void): unknown;
    removeListener(event: "changed", listener: () => void): unknown;
  };
  fetch(url: string, init: RequestInit): Promise<Response>;
}
export interface ForgeLoginWindow {
  once(event: "close" | "closed", listener: () => void): unknown;
  removeListener(event: "close" | "closed", listener: () => void): unknown;
  isDestroyed(): boolean;
  close(): void;
  loadURL(url: string): Promise<void>;
  webContents: {
    on(event: "did-navigate", listener: () => void): unknown;
    removeListener(event: "did-navigate", listener: () => void): unknown;
  };
}

function assertActive(signal: AbortSignal) {
  // 原生请求可能在窗口关闭后才返回；每个异步边界都检查取消状态，不能把迟到回包当作登录成功。
  if (signal.aborted) throw new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED");
}

export function validateForgeWebMediaContext(input: ForgeWebMediaContext): ForgeWebMediaContext {
  const context = forgeWebMediaContextSchema.parse(input);
  const server = new URL(context.serverUrl);
  const login = new URL(context.loginUrl);
  for (const url of [server, login])
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("FORGE_INVALID_MEDIA");
  if (!login.pathname.endsWith("/users/sign_in")) throw new Error("FORGE_INVALID_MEDIA");
  const expected = `${context.serverUrl.replace(/\/+$/, "")}/${context.repository.split("/").map(encodeURIComponent).join("/")}`;
  if (new URL(expected).href !== new URL(context.repositoryUrl).href)
    throw new Error("FORGE_INVALID_MEDIA");
  gitlabUploadApiPath(context.repository, context.repositoryUrl, context.url);
  return context;
}

async function sessionHeader(
  session: ForgeNativeSession,
  context: ForgeWebMediaContext,
): Promise<string> {
  const cookies = await session.cookies.get({ url: context.loginUrl, name: "_gitlab_session" });
  const value = cookies[0]?.value;
  if (!value || /[\r\n;]/.test(value)) throw new Error("FORGE_MEDIA_AUTHENTICATION");
  return `_gitlab_session=${value}`;
}

async function fetchNative(
  session: ForgeNativeSession,
  url: string,
  cookie: string,
  signal: AbortSignal,
) {
  assertActive(signal);
  try {
    // 只使用隔离账户会话的一个 GitLab Cookie，目标固定在已绑定服务器；任何重定向都不携带它继续请求。
    const response = await session.fetch(url, {
      headers: { Cookie: cookie },
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    assertActive(signal);
    return response;
  } catch {
    assertActive(signal);
    throw new Error("FORGE_NETWORK");
  }
}

async function verifiedCookie(
  session: ForgeNativeSession,
  context: ForgeWebMediaContext,
  signal: AbortSignal,
) {
  assertActive(signal);
  const cookie = await sessionHeader(session, context);
  assertActive(signal);
  const response = await fetchNative(
    session,
    `${context.serverUrl.replace(/\/+$/, "")}/api/v4/user`,
    cookie,
    signal,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("FORGE_MEDIA_AUTHENTICATION");
  }
  let user: unknown;
  try {
    user = JSON.parse((await readForgeResponseBytes(response, 64 * 1024)).toString("utf8"));
  } catch {
    assertActive(signal);
    throw new Error("FORGE_RESPONSE");
  }
  assertActive(signal);
  if (
    !user ||
    typeof user !== "object" ||
    !("username" in user) ||
    typeof user.username !== "string"
  )
    throw new Error("FORGE_RESPONSE");
  if (user.username !== context.username) throw new Error("FORGE_MEDIA_IDENTITY_CHANGED");
  return cookie;
}

export function createForgeNativeMediaTransport(deps: {
  session(context: ForgeWebMediaContext): ForgeNativeSession;
  openWindow(context: ForgeWebMediaContext, session: ForgeNativeSession): ForgeLoginWindow;
  authorizationTimeoutMs?: number;
}) {
  return async (
    action: "read" | "authenticate",
    input: ForgeWebMediaContext,
    signal: AbortSignal,
  ): Promise<ForgeImagePreview | void> => {
    const context = validateForgeWebMediaContext(input);
    assertActive(signal);
    const session = deps.session(context);
    if (action === "read") {
      const cookie = await verifiedCookie(session, context, signal);
      const preview = await readForgeImageResponse(
        await fetchNative(session, context.url, cookie, signal),
      );
      assertActive(signal);
      return preview;
    }
    try {
      await verifiedCookie(session, context, signal);
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["FORGE_MEDIA_AUTHENTICATION", "FORGE_MEDIA_IDENTITY_CHANGED"].includes(error.message)
      )
        throw error;
    }
    assertActive(signal);
    const window = deps.openWindow(context, session);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let checking = false;
      let changed = false;
      const finish = (error?: Error, closeWindow = true) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.cookies.removeListener("changed", check);
        window.webContents.removeListener("did-navigate", check);
        window.removeListener("closed", closed);
        window.removeListener("close", closed);
        signal.removeEventListener("abort", aborted);
        if (closeWindow && !window.isDestroyed()) window.close();
        if (error) reject(error);
        else resolve();
      };
      const closed = () => finish(new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED"), false);
      const aborted = () => finish(new Error("FORGE_MEDIA_AUTHENTICATION_CANCELLED"));
      const check = () => {
        if (settled) return;
        // Cookie 和导航事件可能同时到达；保留一次 dirty 标记，不能漏掉登录成功时的新 Cookie。
        if (checking) {
          changed = true;
          return;
        }
        checking = true;
        void verifiedCookie(session, context, signal)
          .then(
            () => finish(),
            (error: unknown) => {
              if (
                !(error instanceof Error) ||
                !["FORGE_MEDIA_AUTHENTICATION", "FORGE_MEDIA_IDENTITY_CHANGED"].includes(
                  error.message,
                )
              )
                finish(new Error("FORGE_NETWORK"));
            },
          )
          .finally(() => {
            checking = false;
            if (changed && !settled) {
              changed = false;
              check();
            }
          });
      };
      const timer = setTimeout(aborted, deps.authorizationTimeoutMs ?? 600_000);
      // Electron 关闭窗口时，loadURL 可能先于 closed 事件失败；在 close 就结算取消，避免误报网络故障。
      window.once("close", closed);
      window.once("closed", closed);
      window.webContents.on("did-navigate", check);
      session.cookies.on("changed", check);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      void window
        .loadURL(context.loginUrl)
        .then(check)
        .catch(() => finish(new Error("FORGE_NETWORK")));
    });
  };
}
