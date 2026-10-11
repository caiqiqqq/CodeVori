import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type IncomingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import type { Duplex } from "node:stream";

interface SubprocessProxyRouter {
  url: string;
  dispose(): Promise<void>;
}

/** 第三方工具没有代理白名单语法，用 loopback HTTP/CONNECT 入口执行同一 Host 路由规则。 */
export async function createSubprocessProxyRouter(options: {
  proxyUrl: string;
  caCertPath?: string;
  shouldProxy(url: URL): boolean;
}): Promise<SubprocessProxyRouter> {
  const proxy = new URL(options.proxyUrl);
  if (!["http:", "https:"].includes(proxy.protocol))
    throw new Error("Invalid subprocess upstream proxy");
  const ca = options.caCertPath
    ? [...rootCertificates, await readFile(options.caCertPath, "utf8")]
    : undefined;
  const authorization =
    proxy.username || proxy.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
      : undefined;
  const sockets = new Set<Duplex>();
  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  const proxyRequest = proxy.protocol === "https:" ? httpsRequest : httpRequest;
  const proxyOptions = {
    hostname: proxy.hostname.replace(/^\[|\]$/g, ""),
    port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
    ca,
    agent: false as const,
  };
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 60_000 }, (req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:" || target.username || target.password)
        throw new Error("Invalid target");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const proxied = options.shouldProxy(target);
    const headers: IncomingHttpHeaders = { ...req.headers, host: target.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    if (proxied && authorization) headers["proxy-authorization"] = authorization;
    const outgoing = proxied
      ? proxyRequest({ ...proxyOptions, method: req.method, path: target.href, headers })
      : httpRequest(target, { method: req.method, headers, agent: false });
    outgoing.on("socket", track);
    outgoing.once("response", (response: IncomingMessage) => {
      const responseHeaders = { ...response.headers };
      delete responseHeaders["proxy-authenticate"];
      res.writeHead(response.statusCode ?? 502, responseHeaders);
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    const failed = () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
      outgoing.destroy();
    };
    outgoing.once("error", failed);
    outgoing.setTimeout(60_000, failed);
    req.once("aborted", () => outgoing.destroy());
    res.once("close", () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on("connection", (socket) => {
    if (sockets.size >= 256) {
      socket.destroy();
      return;
    }
    track(socket);
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (req, client, head) => {
    let target: URL;
    try {
      target = new URL(`https://${req.url}`);
      if (
        !/^(?:\[[a-f\d:]+\]|[\w.-]+):\d+$/i.test(req.url ?? "") ||
        target.username ||
        target.password
      )
        throw new Error("Invalid target");
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const failed = () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    };
    const relay = (upstream: Duplex, pending: Buffer) => {
      track(upstream);
      upstream.on("error", () => client.destroy());
      client.once("close", () => upstream.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (pending.length) client.write(pending);
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    };
    if (!options.shouldProxy(target)) {
      const upstream = track(
        connect({
          host: target.hostname.replace(/^\[|\]$/g, ""),
          port: Number(target.port || 443),
        }),
      );
      upstream.setTimeout(60_000, () => {
        failed();
        upstream.destroy();
      });
      upstream.once("error", failed);
      client.once("close", () => upstream.destroy());
      upstream.once("connect", () => {
        upstream.setTimeout(0);
        relay(upstream, Buffer.alloc(0));
      });
      return;
    }
    // 已匹配代理的 CONNECT 失败不能直连重试，否则用户选择的出口会被悄悄绕过。
    const outgoing = proxyRequest({
      ...proxyOptions,
      method: "CONNECT",
      path: req.url,
      headers: {
        host: req.url,
        ...(authorization ? { "proxy-authorization": authorization } : {}),
      },
    });
    outgoing.on("socket", track);
    outgoing.once("connect", (response, upstream, pending) => {
      if (response.statusCode !== 200) {
        failed();
        upstream.destroy();
        return;
      }
      relay(upstream, pending);
    });
    outgoing.once("error", failed);
    outgoing.setTimeout(60_000, () => {
      failed();
      outgoing.destroy();
    });
    client.once("close", () => outgoing.destroy());
    outgoing.end();
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  let disposal: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    dispose() {
      return (disposal ??= new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }));
    },
  };
}
