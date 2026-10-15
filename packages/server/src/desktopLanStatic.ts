import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, relative, sep } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const compress = promisify(gzip);
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".wasm", ".txt"]);

function acceptsGzip(value: string | undefined): boolean {
  const qualities = new Map<string, number>();
  for (const part of (value ?? "").split(",")) {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    const q = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const quality = q === undefined ? 1 : Number(q.trim().slice(2));
    qualities.set(name!, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
  }
  return (qualities.get("gzip") ?? qualities.get("*") ?? 0) > 0;
}

/** 调用者必须先完成鉴权及 realpath 边界校验；这里仅提供静态构建资源，不缓存业务数据。 */
export async function sendDesktopLanStatic(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  root: string,
  contentType: string,
): Promise<void> {
  const content = await readFile(file);
  const extension = extname(file);
  const html = extension === ".html";
  const immutable =
    relative(root, file).split(sep)[0] === "assets" && /-[\w-]{8,}\.[\w.]+$/.test(basename(file));
  // 旧网关一律 no-store 且直接发送原文，手机每次进入都重新传输整套 Web 包。
  // 私有缓存仅用于静态构建文件；HTML 始终重新获取，带哈希资产才能长期复用。
  response.setHeader("Content-Type", contentType);
  response.setHeader(
    "Cache-Control",
    html ? "no-store" : immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Vary", "Accept-Encoding");
  if (!html) {
    // 弱 ETag 标识解压后的内容，允许 gzip 与 identity 表示共享验证器。
    const etag = `W/"${createHash("sha256").update(content).digest("base64url")}"`;
    response.setHeader("ETag", etag);
    if (
      (request.headers["if-none-match"] ?? "")
        .split(",")
        .some(
          (candidate) =>
            candidate.trim() === "*" || candidate.trim().replace(/^W\//, "") === etag.slice(2),
        )
    ) {
      response.writeHead(304);
      response.end();
      return;
    }
  }
  let body = content;
  if (
    content.length >= 1024 &&
    COMPRESSIBLE.has(extension) &&
    acceptsGzip(request.headers["accept-encoding"])
  ) {
    // 使用异步 zlib，避免桌面 Main 在压缩大 JS/CSS 时阻塞窗口和 attachment 转发。
    const compressed = await compress(content);
    if (compressed.length < content.length) {
      body = compressed;
      response.setHeader("Content-Encoding", "gzip");
    }
  }
  response.setHeader("Content-Length", body.length);
  response.writeHead(200);
  response.end(request.method === "HEAD" ? undefined : body);
}
