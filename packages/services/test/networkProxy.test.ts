import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request } from "node:http";
import {
  normalizeProxyOnlyDomains,
  matchesProxyOnlyDomains,
  appSettingsSchema,
  appSettingsPatchSchema,
} from "@zcode/shared";
import { normalizeSettingsPatch } from "../src/setting/normalizeSettingsPatch.js";
import {
  createHostApiNetworkTransport,
  resolveHostProxyForUrl,
} from "../src/providers/api/nodeApiNetwork.js";

test("domain selection normalizes IDNA, case and duplicates; exact/wildcard boundaries", () => {
  const rules = normalizeProxyOnlyDomains("GitHub.COM., *.Example.com\n例子.测试,github.com");
  assert.equal(rules, "github.com,*.example.com,xn--fsqu00a.xn--0zwm56d");
  assert.equal(matchesProxyOnlyDomains("github.com.", rules), true);
  assert.equal(matchesProxyOnlyDomains("api.github.com", rules), false);
  assert.equal(matchesProxyOnlyDomains("A.example.com", rules), true);
  assert.equal(matchesProxyOnlyDomains("example.com", rules), false);
  assert.equal(matchesProxyOnlyDomains("badexample.com", rules), false);
  assert.equal(matchesProxyOnlyDomains("github.com.evil.test", rules), false);
  assert.equal(matchesProxyOnlyDomains("example.test", undefined), true);
});

test("invalid domain lists cannot be saved and empty clears through RPC normalization", () => {
  for (const value of [
    "https://github.com",
    "github.com:443",
    "github.com/path",
    "*",
    "a.*.test",
    "a.test,,b.test",
    "-bad.test",
    "a.test?query",
    "[::1]",
    Array.from({ length: 65 }, (_, i) => `d${i}.test`).join(","),
  ]) {
    assert.throws(() => normalizeProxyOnlyDomains(value), /domain/i, value);
    assert.equal(appSettingsPatchSchema.safeParse({ httpProxyOnlyDomains: value }).success, false);
  }
  assert.equal(
    appSettingsSchema.parse({ httpProxyOnlyDomains: "GitHub.COM" }).httpProxyOnlyDomains,
    "github.com",
  );
  assert.equal(
    normalizeSettingsPatch({ httpProxyOnlyDomains: "" }).httpProxyOnlyDomains,
    undefined,
  );
  assert.equal(appSettingsPatchSchema.safeParse({ httpProxyOnlyDomains: "" }).success, true);
});

test("Host selection preserves legacy routes and No Proxy has precedence", () => {
  const policy = {
    httpProxy: "http://127.0.0.1:7890",
    onlyDomains: "github.com,*.example.com",
    noProxy: "private.example.com",
  };
  assert.equal(resolveHostProxyForUrl("https://github.com", policy).kind, "proxy");
  assert.equal(resolveHostProxyForUrl("https://other.test", policy).kind, "direct");
  assert.equal(resolveHostProxyForUrl("https://private.example.com", policy).kind, "direct");
  assert.equal(resolveHostProxyForUrl("https://example.com", policy).kind, "direct");
  assert.equal(
    resolveHostProxyForUrl("https://other.test", { httpProxy: policy.httpProxy }).kind,
    "proxy",
  );
  assert.equal(
    resolveHostProxyForUrl("https://github.com", { onlyDomains: policy.onlyDomains }).kind,
    "direct",
  );
});

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
  );
const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
const fetchViaProxy = (proxy: string, target: string) =>
  new Promise<string>((resolve, reject) => {
    const req = request(
      proxy,
      { path: target, headers: { host: new URL(target).host } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          response.statusCode === 200
            ? resolve(Buffer.concat(chunks).toString())
            : reject(new Error(`HTTP ${response.statusCode}`)),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
const tunnelViaProxy = (proxy: string, target: string) =>
  new Promise<string>((resolve, reject) => {
    const req = request(proxy, { method: "CONNECT", path: target });
    req.on("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT ${response.statusCode}`));
        return;
      }
      let result = head.toString();
      socket.on("data", (chunk) => {
        result += chunk;
      });
      socket.on("error", reject);
      socket.on("end", () => resolve(result));
      socket.write("GET / HTTP/1.1\r\nHost: synthetic.test\r\nConnection: close\r\n\r\n");
    });
    req.on("error", reject);
    req.end();
  });

test("Agent loopback router enforces HTTP/CONNECT selection, reuses policy and disposes", async () => {
  const origin = createServer((_req, res) => res.end("DIRECT"));
  const upstream = createServer((_req, res) => res.end("PROXIED"));
  upstream.on("connect", (_req, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nPROXIED"),
    );
  });
  const originPort = await listen(origin),
    proxyPort = await listen(upstream);
  const policy = { httpProxy: `http://127.0.0.1:${proxyPort}`, onlyDomains: "selected.test" };
  const transport = createHostApiNetworkTransport(async () => policy);
  try {
    const router = (await transport.getSubprocessProxyUrl(policy))!;
    assert.equal(await transport.getSubprocessProxyUrl(policy), router);
    assert.equal(new URL(router).hostname, "127.0.0.1");
    assert.equal(await fetchViaProxy(router, "http://selected.test/"), "PROXIED");
    assert.equal(await fetchViaProxy(router, `http://127.0.0.1:${originPort}/`), "DIRECT");
    assert.match(await tunnelViaProxy(router, "selected.test:443"), /PROXIED/);
    assert.match(await tunnelViaProxy(router, `127.0.0.1:${originPort}`), /DIRECT/);
    const bypass = (await transport.getSubprocessProxyUrl({
      ...policy,
      onlyDomains: "127.0.0.1",
      noProxy: "127.0.0.1",
    }))!;
    assert.equal(await fetchViaProxy(bypass, `http://127.0.0.1:${originPort}/`), "DIRECT");
    assert.equal(
      await transport.getSubprocessProxyUrl({ httpProxy: policy.httpProxy }),
      policy.httpProxy,
    );
    await transport.disposeAndWait();
    await assert.rejects(fetchViaProxy(router, "http://selected.test/"));
    await assert.rejects(transport.getSubprocessProxyUrl(policy), /disposed/);
  } finally {
    await transport.disposeAndWait();
    await Promise.all([close(origin), close(upstream)]);
  }
});

test("failed selected upstream does not fall back to direct; initialization/disposal races close routers", async () => {
  let hits = 0;
  const origin = createServer((_req, res) => {
    hits++;
    res.end("DIRECT");
  });
  const dead = createServer();
  const deadPort = await listen(dead);
  await close(dead);
  const originPort = await listen(origin);
  const policy = { httpProxy: `http://127.0.0.1:${deadPort}`, onlyDomains: "127.0.0.1" };
  const transport = createHostApiNetworkTransport(async () => policy);
  try {
    const router = (await transport.getSubprocessProxyUrl(policy))!;
    await assert.rejects(fetchViaProxy(router, `http://127.0.0.1:${originPort}/`), /502/);
    await assert.rejects(tunnelViaProxy(router, `127.0.0.1:${originPort}`), /502/);
    assert.equal(hits, 0);
    const pending = transport.getSubprocessProxyUrl({ ...policy, onlyDomains: "other.test" });
    const disposed = transport.disposeAndWait();
    await assert.rejects(pending, /disposed/);
    await disposed;
  } finally {
    await transport.disposeAndWait();
    await close(origin);
  }
});

test("Host fetch chooses routes again across redirects and preserves Request headers", async () => {
  let originPort = 0,
    proxyHits = 0;
  const origin = createServer((req, res) => {
    if (req.url === "/to-selected") {
      res.writeHead(302, { location: "http://selected.test/final" });
      res.end();
    } else res.end(`DIRECT:${req.headers["x-synthetic"] ?? ""}`);
  });
  originPort = await listen(origin);
  const proxy = createServer();
  proxy.on("connect", (_req, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", (data) => {
      proxyHits++;
      if (data.toString().includes("GET /to-direct"))
        socket.end(
          `HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${originPort}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      else socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nPROXIED");
    });
  });
  const proxyPort = await listen(proxy);
  const transport = createHostApiNetworkTransport(async () => ({
    httpProxy: `http://127.0.0.1:${proxyPort}`,
    onlyDomains: "selected.test",
  }));
  try {
    assert.equal(await (await transport.fetch("http://selected.test/to-direct")).text(), "DIRECT:");
    assert.equal(
      await (await transport.fetch(`http://127.0.0.1:${originPort}/to-selected`)).text(),
      "PROXIED",
    );
    assert.equal(
      await (
        await transport.fetch(
          new Request(`http://127.0.0.1:${originPort}/`, { headers: { "x-synthetic": "kept" } }),
        )
      ).text(),
      "DIRECT:kept",
    );
    assert.equal(proxyHits, 2);
  } finally {
    await transport.disposeAndWait();
    await Promise.all([close(origin), close(proxy)]);
  }
});
