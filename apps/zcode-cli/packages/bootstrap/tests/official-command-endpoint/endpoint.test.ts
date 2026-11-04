/* 官方插件命令进程的代理端点（技术方案 5.8）：CLI 不持有凭证，端点按 session token 认出会话、
 * 只放行 Sites 接口、向 host 现取身份头后转发给 zcode-server。这里用真实的 UDS 和一个本地
 * 假 zcode-server 验证转发细节，凭证解析由 host 侧测试覆盖。 */
import { stat } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ZCODE_OFFICIAL_ENDPOINT_ENV_KEY,
  ZCODE_OFFICIAL_ENDPOINT_TOKEN_ENV_KEY,
} from "@zcode/shared";

import {
  createOfficialCommandEndpoint,
  type OfficialCommandEndpoint,
} from "../../src/official-command-endpoint/index.js";

const IDENTITY = { Authorization: "Bearer zcode-jwt", "X-Bigmodel-Authorization": "Bearer maas" };
const WORKSPACE_A = { workspacePath: "/w/a" };
const WORKSPACE_B = { workspacePath: "/w/b", workspaceIdentity: "remote:b" };

type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer };

async function startUpstream(
  reply: (seen: Seen) => { status: number; body: string } = () => ({
    status: 200,
    body: JSON.stringify({ code: 0, msg: "success", data: { ok: true }, logid: "l" }),
  }),
): Promise<{ origin: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const entry = {
        body: Buffer.concat(chunks),
        headers: req.headers,
        method: req.method ?? "",
        url: req.url ?? "",
      };
      seen.push(entry);
      const { status, body } = reply(entry);
      res.writeHead(status, { "content-type": "application/json", "set-cookie": "a=b" }).end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, seen, server };
}

function call(
  env: Record<string, string>,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    token?: string;
  } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const body = init.body;
    const req = request(
      {
        socketPath: env[ZCODE_OFFICIAL_ENDPOINT_ENV_KEY],
        path,
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${init.token ?? env[ZCODE_OFFICIAL_ENDPOINT_TOKEN_ENV_KEY]}`,
          ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}),
          ...init.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("official command endpoint", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(
    options: {
      reply?: Parameters<typeof startUpstream>[0];
      resolveHeaders?: ReturnType<typeof vi.fn>;
      origin?: string | (() => string);
    } = {},
  ) {
    const upstream = await startUpstream(options.reply);
    cleanups.push(() => new Promise((resolve) => upstream.server.close(() => resolve())));
    const resolveHeaders =
      options.resolveHeaders ?? vi.fn(async () => ({ ok: true as const, headers: IDENTITY }));
    const endpoint: OfficialCommandEndpoint = createOfficialCommandEndpoint({
      appVersion: "3.16.0",
      fetch: globalThis.fetch,
      resolveHeaders,
      resolveZCodeApiOrigin: () =>
        typeof options.origin === "function"
          ? options.origin()
          : (options.origin ?? upstream.origin),
    });
    cleanups.push(() => endpoint.close());
    return { endpoint, resolveHeaders, upstream };
  }

  it("gives each session its own token on one private socket", async () => {
    const { endpoint } = await setup();
    const a = await endpoint.envForSession("session-a", WORKSPACE_A);
    const again = await endpoint.envForSession("session-a", WORKSPACE_A);
    const b = await endpoint.envForSession("session-b", WORKSPACE_B);

    expect(again).toEqual(a);
    expect(b[ZCODE_OFFICIAL_ENDPOINT_ENV_KEY]).toBe(a[ZCODE_OFFICIAL_ENDPOINT_ENV_KEY]);
    expect(b[ZCODE_OFFICIAL_ENDPOINT_TOKEN_ENV_KEY]).not.toBe(
      a[ZCODE_OFFICIAL_ENDPOINT_TOKEN_ENV_KEY],
    );
    if (process.platform !== "win32") {
      const dir = await stat(dirname(a[ZCODE_OFFICIAL_ENDPOINT_ENV_KEY]!));
      expect(dir.mode & 0o077).toBe(0);
    }
  });

  it("asks for identity with the workspace of the session that owns the token", async () => {
    const { endpoint, resolveHeaders } = await setup();
    const a = await endpoint.envForSession("session-a", WORKSPACE_A);
    const b = await endpoint.envForSession("session-b", WORKSPACE_B);

    expect((await call(b, "/api/v1/sites/usage")).status).toBe(200);
    expect((await call(a, "/api/v1/sites/usage")).status).toBe(200);

    expect(resolveHeaders.mock.calls.map(([input]) => input.workspace)).toEqual([
      WORKSPACE_B,
      WORKSPACE_A,
    ]);
  });

  it("rejects unknown tokens and paths outside the allowed prefix without asking for identity", async () => {
    const { endpoint, resolveHeaders, upstream } = await setup();
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);

    const badToken = await call(env, "/api/v1/sites", { token: "forged" });
    expect(badToken.status).toBe(403);
    expect(badToken.headers["x-zcode-official-endpoint-error"]).toBe("invalid");

    for (const path of ["/api/v1/users/me", "/api/v1/sitesx", "/api/v1/sites/../mcp/usage", "/"]) {
      const res = await call(env, path);
      expect(res.status, path).toBe(403);
      expect(JSON.parse(res.body).code).toBe(2007);
    }
    expect(resolveHeaders).not.toHaveBeenCalled();
    expect(upstream.seen).toHaveLength(0);
  });

  it("replaces client credentials with the official identity and streams the body", async () => {
    const { endpoint, resolveHeaders, upstream } = await setup();
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);
    const pkg = Buffer.alloc(3 * 1024 * 1024, 7);

    const res = await call(env, "/api/v1/sites/1/deployments/2/package?x=1", {
      body: pkg,
      headers: {
        "Content-Type": "application/gzip",
        Cookie: "c=d",
        "X-Bigmodel-Authorization": "Bearer forged",
        "X-ZCode-App-Version": "0.0.1",
        "X-Zcode-Plan": "max",
      },
      method: "PUT",
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ code: 0, data: { ok: true } });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(resolveHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "zcode-site", targetOrigin: upstream.origin }),
    );
    const [seen] = upstream.seen;
    expect(seen!.method).toBe("PUT");
    expect(seen!.url).toBe("/api/v1/sites/1/deployments/2/package?x=1");
    expect(seen!.headers.authorization).toBe("Bearer zcode-jwt");
    expect(seen!.headers["x-bigmodel-authorization"]).toBe("Bearer maas");
    expect(seen!.headers["x-zcode-app-version"]).toBe("3.16.0");
    expect(seen!.headers["content-type"]).toBe("application/gzip");
    expect(seen!.headers["content-length"]).toBe(String(pkg.length));
    expect(seen!.headers["transfer-encoding"]).toBeUndefined();
    expect(seen!.headers.cookie).toBeUndefined();
    expect(seen!.headers["x-zcode-plan"]).toBeUndefined();
    expect(seen!.body.equals(pkg)).toBe(true);
  });

  it("answers 401 without identity and 2007 for other identity failures", async () => {
    const resolveHeaders = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "official_auth_unavailable" })
      .mockResolvedValueOnce({ ok: false, reason: "official_mcp_origin_untrusted" })
      .mockRejectedValueOnce(new Error("host gone"));
    const { endpoint, upstream } = await setup({ resolveHeaders });
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);

    const signedOut = await call(env, "/api/v1/sites/usage");
    expect(signedOut.status).toBe(401);
    expect(signedOut.body).toBe("");
    const untrusted = await call(env, "/api/v1/sites/usage");
    expect(untrusted.status).toBe(502);
    expect(JSON.parse(untrusted.body).code).toBe(2007);
    expect((await call(env, "/api/v1/sites/usage")).status).toBe(401);
    expect(upstream.seen).toHaveLength(0);
  });

  it("marks an unreachable zcode-server as a network error", async () => {
    const { endpoint } = await setup({ origin: "http://127.0.0.1:1" });
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);

    const res = await call(env, "/api/v1/sites/usage");
    expect(res.status).toBe(502);
    expect(res.headers["x-zcode-official-endpoint-error"]).toBe("network");
  });

  it("stops serving and removes the socket on close", async () => {
    const { endpoint } = await setup();
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);
    await endpoint.close();

    await expect(call(env, "/api/v1/sites/usage")).rejects.toThrow();
    expect(await endpoint.envForSession("session-a", WORKSPACE_A)).toEqual({});
    if (process.platform !== "win32") {
      await expect(stat(dirname(env[ZCODE_OFFICIAL_ENDPOINT_ENV_KEY]!))).rejects.toThrow();
    }
  });

  it("does not issue credentials from an env request that races endpoint close", async () => {
    const { endpoint } = await setup();
    const pending = endpoint.envForSession("session-a", WORKSPACE_A);
    await endpoint.close();
    expect(await pending).toEqual({});
  });

  it("answers a configuration failure without an unhandled request rejection", async () => {
    const { endpoint, resolveHeaders } = await setup({
      origin: () => {
        throw new Error("invalid config");
      },
    });
    const env = await endpoint.envForSession("session-a", WORKSPACE_A);
    expect((await call(env, "/api/v1/sites/usage")).status).toBe(502);
    expect(resolveHeaders).not.toHaveBeenCalled();
  });
});
