import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  Emitter,
  SocketProtocol,
  VSBuffer,
  HEADER_SIZE,
  type IMessagePassingProtocol,
  type ISocket,
} from "@zcode/rpc";
import { windowHostAttachmentScopeSchema, type WindowHostAttachmentScope } from "@zcode/shared";

export interface DesktopLanAttachment {
  protocol: IMessagePassingProtocol;
  dispose(): void;
}
const COOKIE = "zcode_desktop_lan";
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_BYTES = 32 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
function equalToken(actual: string | undefined, expected: string): boolean {
  const left = Buffer.from(actual ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function cookieToken(request: IncomingMessage): string | undefined {
  for (const entry of (request.headers.cookie ?? "").split(";")) {
    const [name, ...value] = entry.trim().split("=");
    if (name === COOKIE) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
function scopedAttachment(url: URL): WindowHostAttachmentScope {
  if (!url.searchParams.has("scope")) return { kind: "local" };
  return windowHostAttachmentScopeSchema.parse(JSON.parse(url.searchParams.get("scope")!));
}
function send(
  response: ServerResponse,
  status: number,
  body: string,
  type = "text/plain; charset=utf-8",
) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

/** Thin transport only: never creates services/Agent or persists conversation facts. */
export async function createDesktopLanGateway(options: {
  host?: string;
  port?: number;
  token: string;
  staticRoot: string;
  allowedHosts: readonly string[];
  openAttachment: (scope: WindowHostAttachmentScope, onClose: () => void) => DesktopLanAttachment;
}) {
  if (Buffer.byteLength(options.token) < 32)
    throw new Error("Desktop LAN requires a strong access token");
  const root = await realpath(options.staticRoot);
  await stat(resolve(root, "index.html"));
  let closing = false;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  const requestUrl = (request: IncomingMessage) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error("Invalid Host");
    return url;
  };
  const authorize = (response: ServerResponse) => {
    response.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(options.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`,
    );
    response.writeHead(303, {
      Location: "/",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end();
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (closing) {
        send(response, 503, "Desktop LAN access closed");
        return;
      }
      const url = requestUrl(request);
      if (
        request.method === "GET" &&
        equalToken(url.searchParams.get("token") ?? undefined, options.token)
      ) {
        authorize(response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/pair") {
        if (request.headers.origin !== url.origin) {
          send(response, 403, "Forbidden origin");
          return;
        }
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          if (body.length > 2048) {
            send(response, 413, "Request too large");
            return;
          }
        }
        if (!equalToken(new URLSearchParams(body).get("token") ?? undefined, options.token)) {
          send(response, 401, "Unauthorized");
          return;
        }
        authorize(response);
        return;
      }
      if (!equalToken(cookieToken(request), options.token)) {
        send(
          response,
          401,
          url.pathname === "/"
            ? '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZCode LAN</title><form method="post" action="/pair"><label>Access token <input name="token" type="password" required autocomplete="off"></label><button>Connect</button></form>'
            : "Unauthorized",
          url.pathname === "/" ? "text/html; charset=utf-8" : undefined,
        );
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "Method not allowed");
        return;
      }
      if (url.pathname === "/api/desktop-window") {
        send(response, 200, JSON.stringify({ kind: "desktop-window" }), "application/json");
        return;
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
        send(response, 404, "Not found");
        return;
      }
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      const withinRoot = (candidate: string) => {
        const rel = relative(root, candidate);
        return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
      };
      if (!withinRoot(path)) {
        send(response, 403, "Forbidden");
        return;
      }
      let file = path;
      try {
        if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
      } catch {
        if (extname(path)) {
          send(response, 404, "Not found");
          return;
        }
        file = resolve(root, "index.html");
      }
      file = await realpath(file);
      if (!withinRoot(file)) {
        send(response, 403, "Forbidden");
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    })().catch(() => {
      if (!response.headersSent) send(response, 400, "Invalid request");
      else response.end();
    });
  });
  server.on("upgrade", (request, socket, head) => {
    if (closing) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    let scope: WindowHostAttachmentScope;
    try {
      const url = requestUrl(request);
      // Cookie alone cannot authorize a cross-origin WebSocket (including another port).
      if (
        url.pathname !== "/ws" ||
        request.headers.origin !== url.origin ||
        !equalToken(cookieToken(request), options.token)
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      scope = scopedAttachment(url);
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const data = new Emitter<VSBuffer>();
      const close = new Emitter<void>();
      const transport: ISocket = {
        onData: data.event,
        onClose: close.event,
        onEnd: close.event,
        write: (buffer) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          // 手机网络停滞时不能把 Host 输出无限堆在 Main；断开后由 replayable 链路恢复。
          if (
            buffer.byteLength > MAX_MESSAGE_BYTES ||
            ws.bufferedAmount + buffer.byteLength > MAX_PENDING_BYTES
          ) {
            ws.terminate();
            return;
          }
          ws.send(buffer.buffer);
        },
        end: () => ws.close(),
        dispose: () => ws.close(),
        drain: () => Promise.resolve(),
      };
      const protocol = new SocketProtocol(transport);
      let attachment: DesktopLanAttachment | undefined;
      let disposed = false;
      const subscriptions: Array<{ dispose(): void }> = [];
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        for (const subscription of subscriptions) subscription.dispose();
        attachment?.dispose();
        protocol.dispose();
        data.dispose();
        close.dispose();
      };
      ws.on("message", (bytes, isBinary) => {
        if (!isBinary) {
          ws.close(1003, "Binary RPC required");
          return;
        }
        const buffer = Buffer.isBuffer(bytes)
          ? bytes
          : bytes instanceof ArrayBuffer
            ? Buffer.from(bytes)
            : Buffer.concat(bytes);
        // 浏览器 SocketProtocol 每次 write 都是整帧；拒绝伪造超大长度，避免跨消息攒出无界帧。
        if (buffer.length < HEADER_SIZE || buffer.readUInt32BE(9) !== buffer.length - HEADER_SIZE) {
          ws.close(1002, "Complete RPC frame required");
          return;
        }
        data.fire(VSBuffer.wrap(buffer));
      });
      ws.once("close", () => {
        close.fire();
        cleanup();
      });
      ws.once("error", cleanup);
      try {
        attachment = options.openAttachment(scope, () =>
          ws.close(1011, "Desktop Host unavailable"),
        );
        subscriptions.push(
          attachment.protocol.onMessage((buffer) => protocol.send(buffer)),
          protocol.onMessage((buffer) => attachment?.protocol.send(buffer)),
        );
        // Close dead TCP clients too; otherwise their Host attachments outlive the device.
        let alive = true;
        ws.on("pong", () => {
          alive = true;
        });
        const heartbeat = setInterval(() => {
          if (!alive) {
            ws.terminate();
            return;
          }
          alive = false;
          ws.ping();
        }, 30000);
        heartbeat.unref();
        subscriptions.push({ dispose: () => clearInterval(heartbeat) });
      } catch {
        ws.close(1011, "Desktop Host unavailable");
        cleanup();
      }
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop LAN listener unavailable");
  let closeFlight: Promise<void> | undefined;
  return {
    port: address.port,
    close() {
      return (closeFlight ??= (async () => {
        closing = true;
        await Promise.all(
          [...sockets.clients].map(
            (ws) =>
              new Promise<void>((done) => {
                ws.once("close", () => done());
                ws.terminate();
              }),
          ),
        );
        sockets.close();
        server.closeAllConnections();
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      })());
    },
  };
}
