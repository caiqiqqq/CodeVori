import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createDesktopLanGateway } from "../src/desktopLanGateway.js";

test("LAN static compression, private caching and authenticated revalidation", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-lan-static-"));
  const token = "synthetic-static-test-token-32-characters";
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><div>synthetic</div>");
  const source = "export const synthetic = 'mobile resource';\n".repeat(600);
  const asset = "/assets/index-AbCd1234.js";
  await writeFile(join(root, asset), source);
  await writeFile(join(root, "config.json"), '{"version":1}');
  await writeFile(join(root, "assets", "small-AbCd1234.svg"), "<svg/>");
  const gateway = await createDesktopLanGateway({
    host: "127.0.0.1",
    token,
    staticRoot: root,
    allowedHosts: ["127.0.0.1"],
    openAttachment() {
      throw new Error("Static resource tests must not open a Host");
    },
  });
  const origin = `http://127.0.0.1:${gateway.port}`;
  const paired = await fetch(`${origin}/?token=${token}`, { redirect: "manual" });
  const cookie = paired.headers.get("set-cookie")!.split(";")[0]!;
  const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const req = request(
          origin + path,
          { method, headers: { Cookie: cookie, ...headers } },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode!,
                headers: response.headers,
                body: Buffer.concat(chunks),
              }),
            );
            response.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
  try {
    const compressed = await get(asset, { "Accept-Encoding": "gzip" });
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers["content-encoding"], "gzip");
    assert.equal(gunzipSync(compressed.body).toString(), source);
    assert.ok(compressed.body.length < Buffer.byteLength(source) / 4);
    assert.match(compressed.headers["cache-control"]!, /^private,.*immutable/);
    assert.equal(compressed.headers.vary, "Accept-Encoding");
    assert.equal(Number(compressed.headers["content-length"]), compressed.body.length);
    assert.ok(compressed.headers.etag);
    for (const encoding of ["identity", "gzip;q=0, *;q=1", "gzip;q=invalid", "br"]) {
      const identity = await get(asset, { "Accept-Encoding": encoding });
      assert.equal(identity.headers["content-encoding"], undefined, encoding);
      assert.equal(identity.body.toString(), source);
    }
    assert.equal(
      (await get(asset, { "Accept-Encoding": "*;q=0.5" })).headers["content-encoding"],
      "gzip",
    );
    const head = await get(asset, { "Accept-Encoding": "gzip" }, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers["content-length"], compressed.headers["content-length"]);
    assert.equal(head.headers["content-encoding"], "gzip");
    const hit = await get(asset, { "If-None-Match": compressed.headers.etag! });
    assert.equal(hit.status, 304);
    assert.equal(hit.body.length, 0);
    assert.equal(hit.headers.etag, compressed.headers.etag);
    assert.equal((await get(asset, { "If-None-Match": "*" })).status, 304);
    const denied = await get(asset, { Cookie: "", "If-None-Match": compressed.headers.etag! });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers["cache-control"], "no-store");
    await writeFile(join(root, asset), source + "// updated");
    const changed = await get(asset, { "If-None-Match": compressed.headers.etag! });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.etag, compressed.headers.etag);
    for (const path of ["/", "/a-route", "/api/desktop-window", "/missing.js"]) {
      const response = await get(path);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers.etag, undefined);
    }
    const config = await get("/config.json");
    assert.equal(config.headers["cache-control"], "private, no-cache");
    assert.equal(
      (await get("/config.json", { "If-None-Match": config.headers.etag! })).status,
      304,
    );
    assert.equal(
      (await get("/assets/small-AbCd1234.svg", { "Accept-Encoding": "gzip" })).headers[
        "content-encoding"
      ],
      undefined,
    );
  } finally {
    await gateway.close();
    await rm(root, { recursive: true, force: true });
  }
});
