import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pipeline } from "node:stream/promises";
import { c as createTar } from "tar";
import { ZipFile } from "yazl";
import { installAcpBinary, managedAcpBinary } from "../src/acp/acpBinaryInstaller.js";
import { createHostApiNetworkTransport } from "../src/providers/api/nodeApiNetwork.js";

test("binary ACP archive keeps required companion executable and preserves prior release on failed upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-binary-"));
  const content = join(root, "content");
  const archive = join(root, "release.tar.gz");
  const target = join(root, "managed", "binary");
  const release = {
    version: "1.1.1",
    entry: "agy_acp_server.par",
    sibling: "localharness_external",
  };
  await mkdir(content);
  await writeFile(join(content, release.entry), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(join(content, release.sibling), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await createTar({ file: archive, cwd: content, gzip: true }, [release.entry, release.sibling]);
  let payload = await readFile(archive);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/gzip" });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/release.tar.gz`;
    await installAcpBinary(target, url, release);
    assert.equal((await managedAcpBinary(target, release))?.version, "1.1.1");
    await installAcpBinary(target, url, {
      ...release,
      sha256: createHash("sha256").update(payload).digest("hex"),
    });
    await assert.rejects(
      installAcpBinary(target, url, { ...release, version: "1.1.2", sha256: "0".repeat(64) }),
      /checksum/,
    );
    assert.equal((await managedAcpBinary(target, release))?.version, "1.1.1");
    await createTar({ file: archive, cwd: content, gzip: true }, [release.entry]);
    payload = await readFile(archive);
    await assert.rejects(installAcpBinary(target, url, { ...release, version: "1.1.2" }));
    assert.equal((await managedAcpBinary(target, release))?.version, "1.1.1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("ZIP binary release extracts the actual command without a Node/npm dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-zip-"));
  const archive = join(root, "opencode.zip");
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("#!/bin/sh\nexit 0\n"), "opencode");
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(archive));
  const payload = await readFile(archive);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/zip" });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const target = join(root, "managed", "binary");
    const release = { version: "1.18.30", entry: "opencode" };
    await installAcpBinary(target, `http://127.0.0.1:${address.port}/opencode.zip`, release);
    assert.equal((await managedAcpBinary(target, release))?.version, release.version);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("二进制下载复用 Host 代理，网络失败保留旧版本并返回安全原因", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-proxy-"));
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("#!/bin/sh\nexit 0\n"), "opencode");
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  const payload = Buffer.concat(chunks);
  const proxy = createServer();
  const tunnels: string[] = [];
  proxy.on("connect", (request, socket) => {
    tunnels.push(request.url!);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => {
      socket.end(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`,
          ),
          payload,
        ]),
      );
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  const transport = createHostApiNetworkTransport(async () => ({
    httpProxy: `http://127.0.0.1:${address.port}`,
    onlyDomains: "adapter.invalid",
  }));
  const target = join(root, "managed");
  const release = { version: "1.19.3", entry: "opencode" };
  const url = "http://adapter.invalid/opencode.zip";
  try {
    await installAcpBinary(target, url, release, { fetcher: transport.fetch });
    assert.deepEqual(tunnels, ["adapter.invalid:80"]);
    assert.equal((await managedAcpBinary(target, release))?.version, release.version);
    for (const [code, reason] of [
      ["UND_ERR_CONNECT_TIMEOUT", "连接超时"],
      ["ENOTFOUND", "域名解析失败"],
      ["ECONNREFUSED", "连接被拒绝"],
    ]) {
      await assert.rejects(
        installAcpBinary(
          target,
          url,
          { ...release, version: "2.2.0" },
          {
            fetcher: async () => {
              throw new TypeError("fetch failed", {
                cause: Object.assign(new Error("http://user:synthetic-secret@proxy.invalid"), {
                  code,
                }),
              });
            },
          },
        ),
        (error: Error) => {
          assert.ok(error.message.includes(reason!));
          assert.ok(error.message.includes(code!));
          assert.equal(error.message.includes("synthetic-secret"), false);
          return true;
        },
      );
      assert.equal((await managedAcpBinary(target, release))?.version, release.version);
    }
  } finally {
    await transport.disposeAndWait();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
